"""Incident and report logic shared by the citizen and authority routes."""

import json
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .ai import rules
from .config import get_settings
from .errors import ApiError
from .priority import level_of, priority_of
from .refdata import CategoryRef, nearest_area, ref
from .schemas import ReportIn
from .storage import get_storage

# Public columns of an incident plus its title parts and first photo. Used with a pre-filtered
# "page" CTE so the lateral lookups only run for the rows actually returned.
ROW_SELECT = """
SELECT i.id, i.public_id, c.name AS category, c.hazard_points, d.name AS department, w.name AS area, i.address_text, i.severity::text AS severity,
       i.status::text AS status, i.flags, i.affected_count, i.priority_score, i.created_at, i.updated_at,
       fr.problem_type, fr.ai_category, fr.ai_confidence, fr.ai_source, fr.ai_disagreement, fr.nlp, fr.citizen_message, fr.user_corrected, fr.location_source,
       fm.thumb_key, fm.storage_key {extra}
FROM page i
JOIN categories c ON c.id = i.category_id
LEFT JOIN departments d ON d.id = c.department_id
LEFT JOIN wards w ON w.id = i.ward_id
LEFT JOIN LATERAL (SELECT r.problem_type, ac.name AS ai_category, r.ai_confidence, r.ai_source, r.ai_disagreement, r.nlp, r.citizen_message, r.user_corrected, r.location_source
                   FROM reports r LEFT JOIN categories ac ON ac.id = r.ai_category_id
                   WHERE r.incident_id = i.id ORDER BY r.created_at LIMIT 1) fr ON true
LEFT JOIN LATERAL (SELECT m.thumb_key, m.storage_key FROM reports r JOIN media m ON m.report_id = r.id
                   WHERE r.incident_id = i.id ORDER BY r.created_at, m.created_at LIMIT 1) fm ON true
"""


def title_of(problem_type: str | None, category: str, address: str | None) -> str:
    if category == "Other":
        what = problem_type or "Civic problem"
    elif problem_type and category.lower() not in problem_type.lower():
        what = f"{problem_type} {category.lower()}"
    else:
        what = problem_type or category
    return f"{what} at {address}" if address else what


def public_row(row) -> dict:
    storage = get_storage()
    return {
        "id": row.id, "public_id": row.public_id, "title": title_of(row.problem_type, row.category, row.address_text),
        "category": row.category, "area": row.area, "address_text": row.address_text, "severity": row.severity,
        "status": row.status, "flags": list(row.flags), "affected_count": row.affected_count,
        "created_at": row.created_at, "updated_at": row.updated_at,
        "thumb_url": storage.signed_url(row.thumb_key) if row.thumb_key else None,
    }


def ai_summary(row) -> dict:
    """What the AI said about the first report of this incident, and whether the citizen changed the category."""
    disagreement = row.ai_disagreement
    agreement = "disagree" if disagreement else ("agree" if row.ai_source == "image+text" else None)
    return {
        "category": row.ai_category, "confidence": row.ai_confidence, "source": row.ai_source,
        "agreement": agreement, "disagreement": disagreement, "user_corrected": row.user_corrected,
    }


def authority_row(row) -> dict:
    """Decision-support fields for the control room. Each field says where it came from:
    ai = ML models, nlp/reasons = fixed rules, area/lat/lng = PostGIS, department = reference table, citizen_message = user text."""
    d = public_row(row)
    p = priority_of(row.severity, row.category, row.hazard_points, list(row.flags), row.status, row.created_at, row.affected_count)
    d.update(
        priority_score=row.priority_score, level=level_of(row.priority_score), reasons=p.reasons,
        department=row.department, lat=getattr(row, "lat", None), lng=getattr(row, "lng", None),
        location_source=row.location_source, ai=ai_summary(row), nlp=row.nlp, citizen_message=row.citizen_message,
    )
    return d


HOTSPOT_SQL = """
WITH o AS (SELECT * FROM incidents WHERE status <> 'Resolved' AND ward_id IS NOT NULL)
SELECT w.name AS area, count(*) AS open_incidents, sum(o.priority_score)::int AS priority_sum, sum(o.affected_count)::int AS affected,
       count(*) FILTER (WHERE o.priority_score >= 65) AS critical,
       avg(ST_Y(o.location::geometry)) AS lat, avg(ST_X(o.location::geometry)) AS lng,
       (SELECT count(DISTINCT r.user_id) FROM reports r JOIN o o2 ON o2.id = r.incident_id WHERE o2.ward_id = o.ward_id) AS citizens,
       (SELECT count(*) FROM confirmations f JOIN o o3 ON o3.id = f.incident_id WHERE o3.ward_id = o.ward_id) AS confirmations,
       (SELECT json_agg(json_build_object('category', cn, 'count', cnt) ORDER BY cnt DESC, cn) FROM
           (SELECT c.name AS cn, count(*) AS cnt FROM o o4 JOIN categories c ON c.id = o4.category_id WHERE o4.ward_id = o.ward_id GROUP BY c.name) q) AS categories
FROM o JOIN wards w ON w.id = o.ward_id
GROUP BY o.ward_id, w.name
ORDER BY priority_sum DESC, open_incidents DESC
LIMIT :n
"""


async def hotspots(db: AsyncSession, limit: int = 5) -> list[dict]:
    """Open incidents grouped by area (the area is derived from each incident's PostGIS point).
    impact_score = 100 * (area's summed incident priority scores) / (largest area's sum), so the top
    hotspot is 100 and the rest are relative to it. Individual incidents are not merged."""
    rows = (await db.execute(text(HOTSPOT_SQL), {"n": limit})).all()
    top = max((r.priority_sum for r in rows), default=0) or 1
    out = []
    for r in rows:
        cats = r.categories or []
        out.append({
            "area": r.area, "open_incidents": r.open_incidents, "critical": r.critical, "affected": r.affected,
            "unique_citizens": r.citizens, "confirmations": r.confirmations, "priority_sum": r.priority_sum,
            "impact_score": round(100 * r.priority_sum / top), "categories": cats, "main_problems": [c["category"] for c in cats[:2]],
            "lat": r.lat, "lng": r.lng,
        })
    return out


async def recompute_priority(db: AsyncSession, ids: list[uuid.UUID] | None = None) -> int:
    """Recompute the stored score. ids=None refreshes every open incident (the hourly job)."""
    where = "i.id = ANY(CAST(:ids AS uuid[]))" if ids is not None else "i.status <> 'Resolved'"
    result = await db.execute(
        text(f"""UPDATE incidents i SET priority_score = ireport_priority(i.severity, c.hazard_points, i.flags, i.status, i.created_at, i.affected_count)
                 FROM categories c WHERE c.id = i.category_id AND {where}
                 AND i.priority_score IS DISTINCT FROM ireport_priority(i.severity, c.hazard_points, i.flags, i.status, i.created_at, i.affected_count)"""),
        {"ids": [str(i) for i in ids]} if ids is not None else {},
    )
    return result.rowcount


async def resolve_ward(db: AsyncSession, lat: float, lng: float) -> int | None:
    """Ward of the INCIDENT point: PostGIS polygon first, else the nearest seeded area centre.
    The citizen's profile area is never used."""
    ward = await db.scalar(text("SELECT id FROM wards WHERE geom IS NOT NULL AND ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) LIMIT 1"), {"lat": lat, "lng": lng})
    return ward or ref.ward_id(nearest_area(lat, lng))


async def create_report(db: AsyncSession, user_id: uuid.UUID, body: ReportIn) -> dict:
    """Saves one citizen report. Attaches it to an open incident of the same category within the merge
    radius and age (section 4), otherwise creates a new incident. Runs in the caller's transaction."""
    s = get_settings()
    category = ref.category(body.category)
    if category is None:
        raise ApiError(422, "validation_error", "Unknown category.")
    media_ids = list(dict.fromkeys(body.media_ids))
    if media_ids:
        owned = await db.scalar(
            text("SELECT count(*) FROM media WHERE id = ANY(CAST(:ids AS uuid[])) AND uploader_id = :u AND report_id IS NULL"),
            {"ids": [str(m) for m in media_ids], "u": user_id},
        )
        if owned != len(media_ids):
            raise ApiError(422, "invalid_media", "One of the photos was not found. Please add it again.")

    severity, flags = rules.assess(category.name, body.problem_type, body.description, body.flags)
    ai_cat: CategoryRef | None = ref.category(body.ai.category) if body.ai and body.ai.category else None
    point = {"lat": body.lat, "lng": body.lng}

    # Serialise reports per category so two neighbours reporting at the same moment still merge.
    await db.execute(text("SELECT pg_advisory_xact_lock(4242, :c)"), {"c": category.id})
    candidate = await db.scalar(text("""
        SELECT id FROM incidents
        WHERE category_id = :c AND status <> 'Resolved' AND created_at > now() - make_interval(days => :days)
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)
        ORDER BY location <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
        LIMIT 1"""), {**point, "c": category.id, "days": s.merge_max_age_days, "radius": s.merge_radius_m})
    existing = None
    if candidate:
        # Locked separately: FOR UPDATE on a KNN index scan can fail with "attempted to lock invisible tuple".
        existing = (await db.execute(text("""
            SELECT id, public_id, severity::text AS severity, flags,
                   EXISTS (SELECT 1 FROM reports r WHERE r.incident_id = i.id AND r.user_id = :u)
                   OR EXISTS (SELECT 1 FROM confirmations f WHERE f.incident_id = i.id AND f.user_id = :u) AS already_counted
            FROM incidents i WHERE id = :id AND status <> 'Resolved' FOR UPDATE"""), {"id": candidate, "u": user_id})).first()

    if existing:
        incident_id, public_id, merged = existing.id, existing.public_id, True
        row = (await db.execute(text("""
            UPDATE incidents SET affected_count = affected_count + :inc, severity = CAST(:sev AS severity_level),
                   flags = CAST(:flags AS text[]), updated_at = now()
            WHERE id = :id RETURNING affected_count, status::text AS status, severity::text AS severity"""), {
            "id": incident_id, "inc": 0 if existing.already_counted else 1,
            "sev": rules.raise_to(existing.severity, severity), "flags": rules.merge_flags(list(existing.flags), flags),
        })).first()
    else:
        merged = False
        ward_id = await resolve_ward(db, body.lat, body.lng)
        row = (await db.execute(text("""
            INSERT INTO incidents (public_id, category_id, location, ward_id, address_text, severity, flags)
            VALUES ('IR-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-' || lpad(nextval('incident_public_seq')::text, 5, '0'),
                    :c, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :w, :addr, CAST(:sev AS severity_level), CAST(:flags AS text[]))
            RETURNING id, public_id, affected_count, status::text AS status, severity::text AS severity"""), {
            **point, "c": category.id, "w": ward_id, "addr": body.address_text, "sev": severity, "flags": flags,
        })).first()
        incident_id, public_id = row.id, row.public_id
        await db.execute(text("INSERT INTO status_events (incident_id, from_status, to_status, actor_id) VALUES (:i, NULL, 'Reported', :u)"), {"i": incident_id, "u": user_id})

    nlp = rules.extract_nlp(body.description, severity, flags)  # computed here, never trusted from the client
    ai = body.ai
    report_id = await db.scalar(text("""
        INSERT INTO reports (incident_id, user_id, problem_type, description, ai_category_id, ai_confidence, model_version, user_corrected,
                             location_source, citizen_message, ai_source, ai_disagreement, nlp)
        VALUES (:i, :u, :p, :d, :ai, :conf, :mv, :corrected, :src, :msg, :ais, CAST(:dis AS jsonb), CAST(:nlp AS jsonb)) RETURNING id"""), {
        "i": incident_id, "u": user_id, "p": body.problem_type, "d": body.description or None,
        "ai": ai_cat.id if ai_cat else None, "conf": ai.confidence if ai else None,
        "mv": ai.model_version if ai else None, "corrected": bool(ai_cat and ai_cat.id != category.id),
        "src": body.location_source, "msg": body.citizen_message,
        "ais": ai.source if ai else None, "dis": json.dumps(ai.disagreement) if ai and ai.disagreement else None,
        "nlp": json.dumps(nlp) if nlp else None,
    })
    if media_ids:
        await db.execute(text("UPDATE media SET report_id = :r WHERE id = ANY(CAST(:ids AS uuid[])) AND uploader_id = :u AND report_id IS NULL"), {"r": report_id, "ids": [str(m) for m in media_ids], "u": user_id})
    await recompute_priority(db, [incident_id])
    place = (await db.execute(text("SELECT w.name AS area FROM incidents i LEFT JOIN wards w ON w.id = i.ward_id WHERE i.id = :i"), {"i": incident_id})).first()
    return {"report_id": report_id, "incident_id": incident_id, "incident_public_id": public_id, "merged": merged,
            "affected_count": row.affected_count, "severity": row.severity, "status": row.status,
            "area": place.area if place else None, "department": ref.departments.get(category.department_id)}


async def history(db: AsyncSession, incident_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    out: dict[uuid.UUID, list[dict]] = {i: [] for i in incident_ids}
    if not incident_ids:
        return out
    rows = await db.execute(text("SELECT incident_id, to_status::text AS status, created_at FROM status_events WHERE incident_id = ANY(CAST(:ids AS uuid[])) ORDER BY created_at, id"), {"ids": [str(i) for i in incident_ids]})
    for r in rows:
        out[r.incident_id].append({"status": r.status, "at": r.created_at})
    return out


def sender_label(role: str, name: str, department: str | None, viewer_id: uuid.UUID | None, sender_id: uuid.UUID, reveal_citizens: bool) -> str:
    if role in ("authority", "admin"):
        return f"{name} · {department or 'Authority'}"
    if viewer_id == sender_id:
        return "You"
    return name if reveal_citizens else "Citizen"


async def thread(db: AsyncSession, incident_ids: list[uuid.UUID], viewer_id: uuid.UUID, as_authority: bool) -> dict[uuid.UUID, list[dict]]:
    """Messages per incident. Citizens see authority messages addressed to all reporters or to them,
    plus their own replies. Authorities see the whole thread."""
    out: dict[uuid.UUID, list[dict]] = {i: [] for i in incident_ids}
    if not incident_ids:
        return out
    visibility = "" if as_authority else "AND ((u.role <> 'citizen' AND (m.recipient_id IS NULL OR m.recipient_id = :v)) OR m.sender_id = :v)"
    rows = await db.execute(text(f"""
        SELECT m.id, m.incident_id, m.sender_id, m.body, m.created_at, m.read_at, u.role::text AS role, u.name, d.name AS department
        FROM messages m JOIN users u ON u.id = m.sender_id
        LEFT JOIN authority_profiles a ON a.user_id = u.id LEFT JOIN departments d ON d.id = a.department_id
        WHERE m.incident_id = ANY(CAST(:ids AS uuid[])) {visibility}
        ORDER BY m.created_at, m.id"""), {"ids": [str(i) for i in incident_ids], "v": viewer_id})
    for r in rows:
        out[r.incident_id].append({
            "id": r.id, "from": "citizen" if r.role == "citizen" else "authority",
            "by": sender_label(r.role, r.name, r.department, viewer_id, r.sender_id, as_authority),
            "text": r.body, "at": r.created_at,
        })
    return out


async def apply_update(db: AsyncSession, actor_id: uuid.UUID, ids: list[uuid.UUID], status: str | None, message: str | None, flags: list[str] | None = None) -> list[uuid.UUID]:
    """Status change, message and flag edit for one or many incidents, in the caller's transaction.
    Writes one status_events row per real change. Returns the ids that exist."""
    rows = (await db.execute(text("SELECT id, status::text AS status FROM incidents WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY id FOR UPDATE"), {"ids": [str(i) for i in ids]})).all()
    found = [r.id for r in rows]
    changed = [r for r in rows if status and r.status != status]
    if changed:
        changed_ids = [str(r.id) for r in changed]
        await db.execute(text("""
            INSERT INTO status_events (incident_id, from_status, to_status, actor_id)
            SELECT i.id, i.status, CAST(:st AS issue_status), :a FROM incidents i WHERE i.id = ANY(CAST(:ids AS uuid[]))"""), {"st": status, "a": actor_id, "ids": changed_ids})
        await db.execute(text("""
            UPDATE incidents SET status = CAST(:st AS issue_status), updated_at = now(),
                   resolved_at = CASE WHEN :st = 'Resolved' THEN now() ELSE NULL END
            WHERE id = ANY(CAST(:ids AS uuid[]))"""), {"st": status, "ids": changed_ids})
    if flags is not None and found:
        await db.execute(text("UPDATE incidents SET flags = CAST(:f AS text[]), updated_at = now() WHERE id = ANY(CAST(:ids AS uuid[]))"), {"f": rules.merge_flags(flags), "ids": [str(i) for i in found]})
    body = (message or "").strip()
    if body and found:
        await db.execute(text("""
            INSERT INTO messages (incident_id, sender_id, recipient_id, body)
            SELECT id, :a, NULL, :b FROM unnest(CAST(:ids AS uuid[])) AS id"""), {"a": actor_id, "b": body, "ids": [str(i) for i in found]})
        await db.execute(text("UPDATE incidents SET updated_at = now() WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in found]})
    if found:
        await recompute_priority(db, found)
    return found
