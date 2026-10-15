"""Accountability rules: the checks that make misuse expensive, on both sides of the app. Everything here runs on the server.

Citizens (reports):
- the same photo (perceptual hash, so a re-saved copy or a screenshot of it counts) cannot back two different complaints;
- a photo carrying its own GPS point that is far from the pinned spot sends the report to the officers' review lane;
- every report an officer decides is fake is a strike; at `strike_review_at` strikes the citizen's new reports all go to review, at
  `strike_block_at` they cannot report until old strikes leave the window.

Officers (resolving):
- "Resolved" needs a proof photo taken at the site: phone GPS within `proof_radius_m` of the complaint, a precise fix, a photo whose own
  GPS and capture time (when it has them) agree, and a photo nobody used before. The proof is shown to the citizen who then confirms or
  reopens. A fix that follows the last officer action too quickly is flagged for the admin audit.
"""

import math
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from . import images
from .config import get_settings
from .errors import ApiError
from .storage import get_storage, new_keys
from .uploads import read_limited

PHOTO_MATCH_BITS = 4      # two photos whose 64-bit hashes differ in at most this many bits count as the same photo
PHOTO_ELSEWHERE_M = 300   # a proof photo whose own GPS is further than this from the complaint was taken somewhere else
PHOTO_VS_PHONE_M = 300    # a proof photo whose own GPS is further than this from the phone's position is inconsistent


def metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in metres (equirectangular, exact enough below a few km)."""
    dy, dx = (lat2 - lat1) * 111_320, (lng2 - lng1) * 111_320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


# ----------------------------------------------------------------------------------------------------------- reports

_REUSE_SQL = """
SELECT i2.public_id FROM media m2
LEFT JOIN reports r2 ON r2.id = m2.report_id
JOIN incidents i2 ON i2.id = COALESCE(r2.incident_id, m2.incident_id)
WHERE m2.id <> ALL(CAST(:ids AS uuid[])) AND m2.dhash IS NOT NULL AND m2.dhash <> 0
  AND m2.created_at > now() - make_interval(days => :days)
  AND NOT (m2.report_id IS NULL AND m2.incident_id IS NOT DISTINCT FROM CAST(:skip AS uuid))  -- only this complaint's own earlier proof photos are exempt
  AND bit_count((m2.dhash # CAST(:h AS bigint))::bit(64)) <= :tol
LIMIT 1"""


async def find_reused_photo(db: AsyncSession, media_ids: list[uuid.UUID], skip_incident: uuid.UUID | None = None) -> str | None:
    """Public id of an earlier complaint that already used one of these photos, else None. Drafts that were never attached to a
    complaint do not count; a flat image (hash 0) carries no signal and is skipped."""
    s = get_settings()
    if not s.photo_reuse_block or not media_ids:
        return None
    ids = [str(m) for m in media_ids]
    for h in (await db.execute(text("SELECT dhash FROM media WHERE id = ANY(CAST(:ids AS uuid[])) AND dhash IS NOT NULL AND dhash <> 0"), {"ids": ids})).scalars():
        hit = await db.scalar(text(_REUSE_SQL), {"ids": ids, "h": h, "days": s.photo_reuse_days, "tol": PHOTO_MATCH_BITS, "skip": str(skip_incident) if skip_incident else None})
        if hit:
            return hit
    return None


async def photo_gps_gap(db: AsyncSession, media_ids: list[uuid.UUID], lat: float, lng: float) -> float | None:
    """The largest distance (m) between the pinned spot and the GPS point inside any of these photos, or None if none carries one."""
    rows = (await db.execute(text("SELECT gps_lat, gps_lng FROM media WHERE id = ANY(CAST(:ids AS uuid[])) AND gps_lat IS NOT NULL"), {"ids": [str(m) for m in media_ids]})).all()
    gaps = [metres(lat, lng, r.gps_lat, r.gps_lng) for r in rows]
    return max(gaps) if gaps else None


async def strike_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    return await db.scalar(text("SELECT count(*) FROM report_strikes WHERE user_id = :u AND created_at > now() - make_interval(days => :d)"),
                           {"u": user_id, "d": get_settings().strike_window_days})


async def add_strike(db: AsyncSession, user_id: uuid.UUID, incident_id: uuid.UUID, decided_by: uuid.UUID, reason: str | None) -> None:
    await db.execute(text("INSERT INTO report_strikes (user_id, incident_id, decided_by, reason) VALUES (:u, :i, :d, :r)"),
                     {"u": user_id, "i": incident_id, "d": decided_by, "r": reason})


async def check_reporter(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """Raises 403 for a citizen with too many fake-report strikes; returns a review reason for one with several."""
    s = get_settings()
    strikes = await strike_count(db, user_id)
    if strikes >= s.strike_block_at:
        raise ApiError(403, "account_restricted", "Several of your earlier reports were found to be fake, so new reports are paused for now. Please contact the ward office if you think this is a mistake.")
    return "This citizen has earlier reports that officers found to be fake." if strikes >= s.strike_review_at else None


# --------------------------------------------------------------------------------------------------------- resolving

async def save_proof(db: AsyncSession, officer_id: uuid.UUID, incident_id: uuid.UUID, upload: UploadFile, lat: float, lng: float, accuracy_m: float) -> dict:
    """Validates and stores the officer's after-photo for one complaint. Every refusal says what to do next."""
    s = get_settings()
    place = (await db.execute(text("SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS d, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM incidents WHERE id = :i"),
                              {"i": incident_id, "lat": lat, "lng": lng})).one()
    distance = float(place.d)
    if accuracy_m > s.proof_max_accuracy_m:
        raise ApiError(422, "proof_inaccurate", f"Your phone's location is only accurate to {round(accuracy_m)} m. Move to open sky, wait a few seconds and try again.")
    if distance > s.proof_radius_m:
        raise ApiError(422, "proof_too_far", f"You are {round(distance)} m from this complaint. Go to the site (within {round(s.proof_radius_m)} m) and take the photo there.",
                       extra={"distance_m": round(distance), "radius_m": round(s.proof_radius_m)})
    p = await run_in_threadpool(images.process, await read_limited(upload, s.max_upload_bytes))
    if p.gps:
        if metres(lat, lng, *p.gps) > PHOTO_VS_PHONE_M:
            raise ApiError(422, "proof_gps_mismatch", "The location saved inside the photo does not match where your phone says you are. Take a new photo at the site.")
        if metres(place.lat, place.lng, *p.gps) > PHOTO_ELSEWHERE_M:
            raise ApiError(422, "proof_photo_elsewhere", "This photo was taken somewhere else. Take a new photo at the complaint site.")
    if p.taken_at:
        if datetime.now(UTC) - p.taken_at > timedelta(hours=s.proof_photo_max_age_hours):
            raise ApiError(422, "proof_stale", "This photo is old. Take a new photo now, at the site.")
    storage = get_storage()
    key, thumb_key = new_keys()
    row = (await db.execute(text("""INSERT INTO media (uploader_id, incident_id, storage_key, thumb_key, width, height, bytes, dhash, gps_lat, gps_lng)
                                    VALUES (:u, :i, :k, :t, :w, :h, :b, :d, :gla, :glo) RETURNING id"""),
                            {"u": officer_id, "i": incident_id, "k": key, "t": thumb_key, "w": p.width, "h": p.height, "b": len(p.main), "d": p.dhash,
                             "gla": p.gps[0] if p.gps else None, "glo": p.gps[1] if p.gps else None})).first()
    # A proof photo already used anywhere else (another complaint, a citizen's report, another officer's proof) is refused. Checked after the insert so
    # the new row is excluded by id; the transaction is rolled back by the error, so nothing is kept.
    reused = await find_reused_photo(db, [row.id], skip_incident=incident_id)
    if reused:
        raise ApiError(409, "photo_reused", f"This photo was already used for {reused}. Take a new photo at this site.")
    await storage.put(key, p.main, "image/webp")
    await storage.put(thumb_key, p.thumb, "image/webp")
    # media_ids is also what the draft-photo cleanup job checks, so a proof photo is never deleted as an unattached draft.
    proof_id = await db.scalar(text("""INSERT INTO resolution_proofs (incident_id, actor_id, media_ids, officer_lat, officer_lng, accuracy_m, distance_m)
                                       VALUES (:i, :o, ARRAY[CAST(:m AS uuid)], :lat, :lng, :acc, :d) RETURNING id"""),
                               {"i": incident_id, "o": officer_id, "m": row.id, "lat": lat, "lng": lng, "acc": accuracy_m, "d": distance})
    return {"proof_id": proof_id, "distance_m": round(distance), "accuracy_m": round(accuracy_m), "thumb_url": storage.signed_url(thumb_key)}


async def consume_proof(db: AsyncSession, officer_id: uuid.UUID, incident_id: uuid.UUID, note: str) -> list[str]:
    """Called when an officer marks a complaint Resolved. Uses up this officer's newest unused proof for the complaint (422 if there
    is none), stores the completion note with it, and returns the audit flags. Must run before the status change writes its own events."""
    s = get_settings()
    proof = (await db.execute(text("""SELECT id FROM resolution_proofs WHERE incident_id = :i AND actor_id = :o AND used_at IS NULL
                                      AND created_at > now() - make_interval(hours => :h) ORDER BY created_at DESC LIMIT 1 FOR UPDATE"""),
                              {"i": incident_id, "o": officer_id, "h": s.proof_max_age_hours})).first()
    if not proof:
        raise ApiError(422, "proof_required", "Take a photo at the site before marking this resolved. The photo and your location are checked, and the citizen sees it.")
    started = await db.scalar(text("""SELECT max(created_at) FROM status_events WHERE incident_id = :i AND from_status IS DISTINCT FROM to_status
                                      AND to_status IN ('Acknowledged', 'Scheduled', 'In Progress')"""), {"i": incident_id})
    flags: list[str] = []
    if started is None:
        flags.append("no_prior_action")
    elif await db.scalar(text("SELECT :s > now() - make_interval(mins => :m)"), {"s": started, "m": s.min_work_minutes}):
        flags.append("too_fast")
    await db.execute(text("UPDATE resolution_proofs SET used_at = now(), flags = CAST(:f AS text[]), note = :n WHERE id = :p"), {"f": flags, "n": note[:1000], "p": proof.id})
    return flags


# ------------------------------------------------------------------------------------------------------------ audit

_OFFICER_SQL = """
WITH ev AS (
  SELECT e.to_status::text AS to_status, e.actor_id,
         CASE WHEN e.to_status IN ('Resolved', 'On Hold', 'Rejected') THEN e.actor_id
              WHEN e.to_status IN ('Reopened', 'Closed') THEN
                (SELECT s.actor_id FROM status_events s WHERE s.incident_id = e.incident_id AND s.to_status = 'Resolved' AND s.created_at <= e.created_at
                 ORDER BY s.created_at DESC, s.id DESC LIMIT 1) END AS officer_id
  FROM status_events e WHERE e.created_at > now() - make_interval(days => :d) AND e.from_status IS DISTINCT FROM e.to_status),
ev_n AS (
  SELECT officer_id, count(*) FILTER (WHERE to_status = 'Resolved') AS resolved, count(*) FILTER (WHERE to_status = 'Reopened') AS reopened,
         count(*) FILTER (WHERE to_status = 'Closed' AND actor_id IS NOT NULL) AS confirmed, count(*) FILTER (WHERE to_status = 'Closed' AND actor_id IS NULL) AS auto_closed,
         count(*) FILTER (WHERE to_status = 'On Hold') AS holds, count(*) FILTER (WHERE to_status = 'Rejected') AS rejects
  FROM ev WHERE officer_id IS NOT NULL GROUP BY officer_id),
pr AS (
  SELECT actor_id AS officer_id, count(*) AS with_proof, count(*) FILTER (WHERE 'too_fast' = ANY(flags)) AS too_fast, count(*) FILTER (WHERE 'no_prior_action' = ANY(flags)) AS no_prior_action
  FROM resolution_proofs WHERE used_at > now() - make_interval(days => :d) GROUP BY actor_id)
SELECT u.id, u.name, w.name AS area, dep.name AS department,
       coalesce(n.resolved, 0) AS resolved, coalesce(p.with_proof, 0) AS with_proof, coalesce(p.too_fast, 0) AS too_fast, coalesce(p.no_prior_action, 0) AS no_prior_action,
       coalesce(n.reopened, 0) AS reopened, coalesce(n.confirmed, 0) AS confirmed, coalesce(n.auto_closed, 0) AS auto_closed,
       coalesce(n.holds, 0) AS holds, coalesce(n.rejects, 0) AS rejects
FROM users u JOIN authority_profiles a ON a.user_id = u.id LEFT JOIN wards w ON w.id = u.ward_id LEFT JOIN departments dep ON dep.id = a.department_id
LEFT JOIN ev_n n ON n.officer_id = u.id LEFT JOIN pr p ON p.officer_id = u.id
WHERE u.role = 'authority' AND a.approval = 'approved' AND u.deleted_at IS NULL ORDER BY coalesce(n.resolved, 0) DESC, u.name LIMIT 200"""

_FLAGGED_SQL = """
SELECT * FROM (SELECT DISTINCT ON (i.id) i.id, i.public_id, i.status::text AS status, w.name AS area, u.name AS officer, e.created_at AS resolved_at,
       p.flags, p.distance_m, i.reopen_count > 0 AS reopened, p.flags IS NULL AS no_proof
FROM status_events e JOIN incidents i ON i.id = e.incident_id JOIN users u ON u.id = e.actor_id LEFT JOIN wards w ON w.id = i.ward_id
LEFT JOIN LATERAL (SELECT flags, distance_m FROM resolution_proofs x WHERE x.incident_id = i.id AND x.actor_id = e.actor_id AND x.used_at IS NOT NULL ORDER BY x.used_at DESC LIMIT 1) p ON true
WHERE e.to_status = 'Resolved' AND e.from_status IS DISTINCT FROM e.to_status AND e.created_at > now() - make_interval(days => :d)
  AND (p.flags IS NULL OR cardinality(p.flags) > 0 OR i.reopen_count > 0)
ORDER BY i.id, e.created_at DESC) latest ORDER BY resolved_at DESC LIMIT 30"""  # one row per complaint: its latest resolution


def attention_for(o: dict, proof_required: bool) -> list[str]:
    """Plain-language reasons an admin should look at one officer. Thresholds are deliberately simple and visible."""
    out = []
    if o["resolved"] >= 3 and o["reopened"] / o["resolved"] >= 0.25:
        out.append(f"Citizens reopened {o['reopened']} of {o['resolved']} fixes")
    if proof_required and o["resolved"] > o["with_proof"]:
        out.append(f"{o['resolved'] - o['with_proof']} fix(es) marked resolved without a site photo")
    if o["too_fast"] or o["no_prior_action"]:
        out.append(f"{o['too_fast'] + o['no_prior_action']} fix(es) resolved right after the last action, or with no earlier action")
    if o["auto_closed"] >= 3 and o["auto_closed"] / max(1, o["auto_closed"] + o["confirmed"]) > 0.7:
        out.append(f"{o['auto_closed']} fixes closed by timeout, not confirmed by the citizen")
    if o["holds"] + o["rejects"] >= 5 and o["holds"] + o["rejects"] > 2 * max(1, o["resolved"]):
        out.append(f"{o['holds']} holds and {o['rejects']} rejections against {o['resolved']} fixes")
    return out


async def audit_report(db: AsyncSession, days: int) -> dict:
    """What the admin sees: per officer, how many fixes had a site photo, were confirmed by citizens, were reopened or closed by timeout,
    and how many complaints were held or rejected; plus the latest resolutions that look wrong. Counted from status_events and
    resolution_proofs only; nothing is estimated."""
    s = get_settings()
    officers = []
    for r in (await db.execute(text(_OFFICER_SQL), {"d": days})).mappings():
        o = dict(r)
        o["attention"] = attention_for(o, s.require_resolution_proof)
        officers.append(o)
    flagged = [dict(r) for r in (await db.execute(text(_FLAGGED_SQL), {"d": days})).mappings()]
    strikes = (await db.execute(text("SELECT count(*) AS n FROM report_strikes WHERE created_at > now() - make_interval(days => :w) GROUP BY user_id"), {"w": s.strike_window_days})).scalars().all()
    return {
        "days": days, "proof_required": s.require_resolution_proof, "proof_radius_m": round(s.proof_radius_m), "min_work_minutes": s.min_work_minutes,
        "officers": officers, "flagged": flagged,
        "reporters": {"with_strikes": len(strikes), "in_review": sum(1 for n in strikes if n >= s.strike_review_at), "paused": sum(1 for n in strikes if n >= s.strike_block_at),
                      "review_at": s.strike_review_at, "pause_at": s.strike_block_at, "window_days": s.strike_window_days},
        "totals": {k: sum(o[k] for o in officers) for k in ("resolved", "with_proof", "reopened", "confirmed", "auto_closed", "holds", "rejects", "too_fast")},
    }
