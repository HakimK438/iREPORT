"""Officer and citizen actions on a complaint. Every rule below is enforced here, on the backend; the UI only
mirrors it. Every status change writes a status_events row with the actor and a reason.

Rules (README.md (Design decisions), "Workflow"):
- Resolved is one click (owner decision, README.md (Design decisions) #79); the citizen then confirms or reopens.
- Rejected and On Hold need a reason. Duplicate needs the complaint no. it duplicates; the reporters move to it.
- Transferred needs the correct category (the department follows the category) and a reason.
- Closed and Reopened belong to the citizen (or to the 72 h auto-close job), never to an officer.
- Bulk can acknowledge, assign, schedule, resolve and message.
"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import incidents as svc
from . import risk_config as cfg
from .ai import rules
from .errors import ApiError, not_found
from .priority import response_of
from .refdata import ref
from .schemas import AuthorityUpdate, BulkUpdate
from .status import LOCKED_STATUSES

_SIDE_EXITS = {"On Hold", "Rejected", "Duplicate", "Transferred"}
ALLOWED: dict[str, set[str]] = {
    "Reported": {"Acknowledged", "Scheduled", "In Progress", "Resolved"} | _SIDE_EXITS,
    "Acknowledged": {"Scheduled", "In Progress", "Resolved"} | _SIDE_EXITS,
    "Scheduled": {"Acknowledged", "In Progress", "Resolved"} | _SIDE_EXITS,
    "In Progress": {"Acknowledged", "Scheduled", "Resolved"} | _SIDE_EXITS,
    "Reopened": {"Acknowledged", "Scheduled", "In Progress", "Resolved"} | _SIDE_EXITS,
    "On Hold": {"Acknowledged", "Scheduled", "In Progress", "Resolved", "Rejected", "Duplicate", "Transferred"},
    "Resolved": {"In Progress"},  # rework after a premature "Resolved"
}
NEEDS_REASON = {"On Hold": "Say why the complaint is on hold.", "Rejected": "Say why the complaint is rejected.", "Transferred": "Say why it is transferred."}


async def _approved_officer(db: AsyncSession, user_id: uuid.UUID) -> str:
    name = await db.scalar(text("""SELECT u.name FROM users u JOIN authority_profiles a ON a.user_id = u.id
                                   WHERE u.id = :u AND u.role = 'authority' AND a.approval = 'approved' AND u.deleted_at IS NULL"""), {"u": user_id})
    if not name:
        raise ApiError(422, "unknown_officer", "Choose an approved officer from the list.")
    return name


async def _event(db: AsyncSession, incident_id: uuid.UUID, frm: str | None, to: str, actor: uuid.UUID | None, reason: str | None) -> None:
    await db.execute(text("INSERT INTO status_events (incident_id, from_status, to_status, actor_id, reason) VALUES (:i, CAST(:f AS issue_status), CAST(:t AS issue_status), :a, :r)"),
                     {"i": incident_id, "f": frm, "t": to, "a": actor, "r": reason})


async def _merge_into(db: AsyncSession, officer: uuid.UUID, row, target_public_id: str) -> uuid.UUID:
    """Duplicate: move the reporters (reports, their photos, confirmations) to the target and recompute its count."""
    target = (await db.execute(text("SELECT id, public_id, status::text AS status FROM incidents WHERE public_id = :p FOR UPDATE"), {"p": target_public_id.upper()})).first()
    if not target:
        raise ApiError(422, "unknown_complaint", f"No complaint {target_public_id}.")
    if target.id == row.id:
        raise ApiError(422, "same_complaint", "A complaint cannot be a duplicate of itself.")
    if target.status in ("Duplicate", "Rejected"):
        raise ApiError(422, "bad_target", f"{target.public_id} is {target.status}. Choose the complaint it was merged into.")
    await db.execute(text("UPDATE reports SET incident_id = :t WHERE incident_id = :s"), {"t": target.id, "s": row.id})
    await db.execute(text("""INSERT INTO confirmations (incident_id, user_id, created_at) SELECT :t, user_id, created_at FROM confirmations WHERE incident_id = :s
                             ON CONFLICT DO NOTHING"""), {"t": target.id, "s": row.id})
    await db.execute(text("DELETE FROM confirmations WHERE incident_id = :s"), {"s": row.id})
    # A citizen who had reported both complaints now has two reports on the target: keep the earliest, flag the rest.
    await db.execute(text("""UPDATE reports r SET duplicate_of_report_id = f.id
                             FROM (SELECT DISTINCT ON (user_id) user_id, id FROM reports WHERE incident_id = :t AND duplicate_of_report_id IS NULL ORDER BY user_id, created_at, id) f
                             WHERE r.incident_id = :t AND r.user_id = f.user_id AND r.id <> f.id AND r.duplicate_of_report_id IS NULL"""), {"t": target.id})
    await db.execute(text("""UPDATE incidents SET affected_count = greatest(1, (SELECT count(*) FROM (SELECT user_id FROM reports WHERE incident_id = :t AND duplicate_of_report_id IS NULL
                                                                                UNION SELECT user_id FROM confirmations WHERE incident_id = :t) u)),
                                    updated_at = now() WHERE id = :t"""), {"t": target.id})
    await _event(db, target.id, target.status, target.status, officer, f"Complaint {row.public_id} was merged into this one.")
    await svc.recompute_priority(db, [target.id])
    return target.id


async def apply_officer_update(db: AsyncSession, officer: uuid.UUID, incident_id: uuid.UUID, body: AuthorityUpdate) -> dict:
    """One officer action on one complaint, in the caller's transaction. Validates everything before writing anything."""
    row = (await db.execute(text("""SELECT id, public_id, status::text AS status, category_id, assigned_to, scheduled_for, created_at
                                    FROM incidents WHERE id = :i FOR UPDATE"""), {"i": incident_id})).first()
    if not row:
        raise not_found("Incident")
    cur, new = row.status, body.status
    changes_state = bool(new and new != cur) or body.assigned_to is not None or body.scheduled_for is not None or body.flags is not None
    if cur in LOCKED_STATUSES and changes_state:
        raise ApiError(409, "status_locked", f"This complaint is {cur} and can no longer be changed.")

    # ---- validate ----
    target_category = None
    if new and new != cur:
        if new in ("Reopened", "Closed"):
            raise ApiError(422, "citizen_only", f"{new} is set by the citizen who reported it, or automatically after {cfg.AUTO_CLOSE_HOURS} hours.")
        if new not in ALLOWED.get(cur, set()):
            raise ApiError(409, "invalid_transition", f"A complaint that is {cur} cannot be moved to {new}.")
        if new in NEEDS_REASON and not body.reason:
            raise ApiError(422, "reason_required", NEEDS_REASON[new])
        if new == "Scheduled" and not (body.scheduled_for or row.scheduled_for):
            raise ApiError(422, "date_required", "Choose the site visit or work date.")
        if new == "Duplicate" and not body.duplicate_of:
            raise ApiError(422, "duplicate_target_required", "Enter the complaint no. this one duplicates.")
        if new == "Transferred":
            target_category = ref.category(body.category)
            if target_category is None:
                raise ApiError(422, "category_required", "Choose the correct category; the department follows it.")
            if target_category.id == row.category_id:
                raise ApiError(422, "same_category", "That is already the category of this complaint.")
    officer_name = await _approved_officer(db, body.assigned_to) if body.assigned_to else None

    # ---- write ----
    if body.assigned_to and body.assigned_to != row.assigned_to:
        await db.execute(text("UPDATE incidents SET assigned_to = :a, updated_at = now() WHERE id = :i"), {"a": body.assigned_to, "i": incident_id})
        await _event(db, incident_id, cur, cur, officer, f"Assigned to {officer_name}")
    if body.scheduled_for and body.scheduled_for != row.scheduled_for:
        await db.execute(text("UPDATE incidents SET scheduled_for = :d, updated_at = now() WHERE id = :i"), {"d": body.scheduled_for, "i": incident_id})
        if not (new == "Scheduled" and cur != "Scheduled"):
            await _event(db, incident_id, cur, cur, officer, f"Scheduled for {body.scheduled_for:%d %b %Y}")

    if new and new != cur:
        reason = body.reason
        resolved_clause = "now()" if new == "Resolved" else "NULL"
        await db.execute(text(f"""UPDATE incidents SET status = CAST(:st AS issue_status), updated_at = now(), resolved_at = {resolved_clause},
                                  status_reason = :r WHERE id = :i"""), {"st": new, "r": reason if new in NEEDS_REASON or new in ("Duplicate", "Resolved") else None, "i": incident_id})
        if new == "Scheduled":
            await _event(db, incident_id, cur, new, officer, f"Site visit on {(body.scheduled_for or row.scheduled_for):%d %b %Y}")
        elif new == "Duplicate":
            target_id = await _merge_into(db, officer, row, body.duplicate_of)
            await db.execute(text("UPDATE incidents SET duplicate_of = :t WHERE id = :i"), {"t": target_id, "i": incident_id})
            await _event(db, incident_id, cur, new, officer, f"Duplicate of {body.duplicate_of.upper()}")
        elif new == "Transferred":
            old_dept = ref.departments.get(ref.categories[row.category_id].department_id)
            new_dept = ref.departments.get(target_category.department_id)
            await _event(db, incident_id, cur, new, officer, f"{body.reason} ({old_dept} -> {new_dept})")
            # Transferred is a hand-over, not a place to rest: the complaint re-enters the new department's queue as Reported.
            await db.execute(text("UPDATE incidents SET category_id = :c, status = 'Reported', assigned_to = NULL, due_at = NULL, status_reason = :r WHERE id = :i"),
                             {"c": target_category.id, "r": body.reason, "i": incident_id})
            await _event(db, incident_id, new, "Reported", officer, f"Awaiting acknowledgement by {new_dept}")
        else:
            await _event(db, incident_id, cur, new, officer, reason)

    if body.flags is not None:
        await db.execute(text("UPDATE incidents SET flags = CAST(:f AS text[]), updated_at = now() WHERE id = :i"), {"f": rules.merge_flags(body.flags), "i": incident_id})
    msg = (body.message or "").strip()
    if msg:
        await db.execute(text("INSERT INTO messages (incident_id, sender_id, recipient_id, body) VALUES (:i, :a, NULL, :b)"), {"i": incident_id, "a": officer, "b": msg})
        await db.execute(text("UPDATE incidents SET updated_at = now() WHERE id = :i"), {"i": incident_id})
    await svc.recompute_priority(db, [incident_id])
    if new == "Transferred":  # the due date restarts with the new category's response time
        await svc.refresh_geo_facts(db, [incident_id])
        await svc.recompute_priority(db, [incident_id])
    out = (await db.execute(text("SELECT status::text AS status, priority_score, risk, due_at, flags, updated_at, assigned_to FROM incidents WHERE id = :i"), {"i": incident_id})).one()
    return {"id": incident_id, "status": out.status, "priority_score": out.priority_score, "response": response_of(out.risk)[0], "due_at": out.due_at,
            "flags": list(out.flags), "updated_at": out.updated_at, "assigned_to": out.assigned_to}


async def apply_bulk(db: AsyncSession, officer: uuid.UUID, body: BulkUpdate) -> dict:
    """Acknowledge, assign, schedule and message many complaints. Complaints where the move is not allowed are skipped and reported."""
    done, skipped = [], []
    for incident_id in dict.fromkeys(body.ids):
        one = AuthorityUpdate(status=body.status, message=body.message, assigned_to=body.assigned_to, scheduled_for=body.scheduled_for)
        try:
            await apply_officer_update(db, officer, incident_id, one)
            done.append(incident_id)
        except ApiError as e:  # validated before any write, so the transaction is still clean
            skipped.append({"id": incident_id, "code": e.code, "message": e.message})
    return {"updated": len(done), "ids": done, "skipped": skipped}


async def citizen_resolution(db: AsyncSession, user_id: uuid.UUID, incident_id: uuid.UUID, confirm: bool, reason: str | None = None) -> dict:
    """A reporting citizen answers a Resolved complaint: Confirm -> Closed, or Reopen with a reason -> Reopened
    (reopen_count + 1; due_at is left alone, so the SLA clock keeps running)."""
    reported = await db.scalar(text("SELECT EXISTS (SELECT 1 FROM reports WHERE incident_id = :i AND user_id = :u AND duplicate_of_report_id IS NULL)"), {"i": incident_id, "u": user_id})
    if not reported:
        raise not_found("Report")
    cur = await db.scalar(text("SELECT status::text FROM incidents WHERE id = :i FOR UPDATE"), {"i": incident_id})
    if cur != "Resolved":
        raise ApiError(409, "not_resolved", "This complaint is not waiting for your answer.")
    if confirm:
        await db.execute(text("UPDATE incidents SET status = 'Closed', updated_at = now() WHERE id = :i"), {"i": incident_id})
        await _event(db, incident_id, cur, "Closed", user_id, "Citizen confirmed the work is done.")
        new = "Closed"
    else:
        await db.execute(text("UPDATE incidents SET status = 'Reopened', reopen_count = reopen_count + 1, resolved_at = NULL, status_reason = :r, updated_at = now() WHERE id = :i"),
                         {"i": incident_id, "r": reason})
        await _event(db, incident_id, cur, "Reopened", user_id, reason)
        await db.execute(text("INSERT INTO messages (incident_id, sender_id, body) VALUES (:i, :u, :b)"), {"i": incident_id, "u": user_id, "b": f"Reopened: {reason}"})
        new = "Reopened"
    await svc.recompute_priority(db, [incident_id])
    return {"id": incident_id, "status": new}


async def auto_close_resolved(db: AsyncSession) -> int:
    """Resolved complaints nobody answered for 72 h are Closed (job in jobs.py). Writes the status event, no actor."""
    result = await db.execute(text(f"""
        WITH due AS (UPDATE incidents SET status = 'Closed', updated_at = now()
                     WHERE status = 'Resolved' AND resolved_at < now() - make_interval(hours => {cfg.AUTO_CLOSE_HOURS}) RETURNING id)
        INSERT INTO status_events (incident_id, from_status, to_status, actor_id, reason)
        SELECT id, 'Resolved', 'Closed', NULL, 'No answer from the citizen within {cfg.AUTO_CLOSE_HOURS} hours.' FROM due"""))
    return result.rowcount

