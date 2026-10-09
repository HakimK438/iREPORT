"""Incident and report logic shared by the citizen and authority routes."""

import json
import math
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import risk_config as cfg
from . import status as status_mod
from .ai import rules
from .answers import flags_from_answers
from .config import get_settings
from .errors import ApiError
from .priority import response_of
from .refdata import CategoryRef, nearest_area, ref
from .schemas import ReportIn
from .status import open_sql
from .storage import get_storage

# Public columns of an incident plus its title parts and first photo. Used with a pre-filtered
# "page" CTE so the lateral lookups only run for the rows actually returned.
ROW_SELECT = """
SELECT i.id, i.public_id, c.name AS category, c.hazard_points, d.name AS department, w.name AS area, i.address_text, i.severity::text AS severity,
       i.status::text AS status, i.flags, i.affected_count, i.priority_score, i.risk, i.due_at, i.scheduled_for, i.reopen_count, i.status_reason,
       i.assigned_to, au.name AS assignee_name, cz.n AS citizens, i.created_at, i.updated_at,
       fr.problem_type, fr.ai_category, fr.ai_confidence, fr.ai_source, fr.ai_disagreement, fr.nlp, fr.citizen_message, fr.user_corrected, fr.location_source,
       fr.sample_confidence, fr.answers, fm.thumb_key, fm.storage_key {extra}
FROM page i
JOIN categories c ON c.id = i.category_id
LEFT JOIN departments d ON d.id = c.department_id
LEFT JOIN wards w ON w.id = i.ward_id
LEFT JOIN users au ON au.id = i.assigned_to
LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM (SELECT user_id FROM reports WHERE incident_id = i.id AND duplicate_of_report_id IS NULL
                                                  UNION SELECT user_id FROM confirmations WHERE incident_id = i.id) u) cz ON true
LEFT JOIN LATERAL (SELECT r.problem_type, ac.name AS ai_category, r.ai_confidence, r.ai_source, r.ai_disagreement, r.nlp, r.citizen_message, r.user_corrected, r.location_source, r.sample_confidence, r.answers
                   FROM reports r LEFT JOIN categories ac ON ac.id = r.ai_category_id
                   WHERE r.incident_id = i.id AND r.duplicate_of_report_id IS NULL ORDER BY r.created_at LIMIT 1) fr ON true
LEFT JOIN LATERAL (SELECT m.thumb_key, m.storage_key FROM reports r JOIN media m ON m.report_id = r.id
                   WHERE r.incident_id = i.id AND r.duplicate_of_report_id IS NULL ORDER BY r.created_at, m.created_at LIMIT 1) fm ON true
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
        "status": row.status, "flags": list(row.flags), "affected_count": row.affected_count, "citizens": row.citizens,
        "created_at": row.created_at, "updated_at": row.updated_at,
        "thumb_url": storage.signed_url(row.thumb_key) if row.thumb_key else None,
        # Set only for example incidents whose photo is a training-dataset image: the image model's confidence for it.
        "sample_confidence": getattr(row, "sample_confidence", None),
    }


def ai_summary(row) -> dict:
    """What the photo model said about the first report of this incident, and whether the citizen changed the category.
    The control room shows it only when the model disagrees with the chosen category."""
    disagreement = row.ai_disagreement
    agreement = "disagree" if disagreement else ("agree" if row.ai_source == "image+text" else None)
    return {
        "category": row.ai_category, "confidence": row.ai_confidence, "source": row.ai_source,
        "agreement": agreement, "disagreement": disagreement, "user_corrected": row.user_corrected,
    }


def due_fields(status: str, due_at: datetime | None, now: datetime | None = None) -> dict:
    """due_at plus the officer-facing overdue facts. Overdue = open and now > due_at (one rule, used everywhere)."""
    now = now or datetime.now(UTC)
    overdue = bool(due_at and status_mod.is_open(status) and now > due_at)
    return {"due_at": due_at, "overdue": overdue, "overdue_days": max(0, math.floor((now - due_at).total_seconds() / 86400)) if overdue and due_at else 0}


def authority_row(row) -> dict:
    """Decision fields for the control room: what, where, how urgent (response category and due date), who acts next."""
    d = public_row(row)
    response, hours = response_of(row.risk)
    d.update(
        risk=row.risk, response=response, response_hours=hours, priority_score=row.priority_score, **due_fields(row.status, row.due_at),
        scheduled_for=row.scheduled_for, reopen_count=row.reopen_count, status_reason=row.status_reason,
        assignee=({"id": row.assigned_to, "name": row.assignee_name} if row.assigned_to else None),
        department=row.department, lat=getattr(row, "lat", None), lng=getattr(row, "lng", None),
        location_source=row.location_source, ai=ai_summary(row), nlp=row.nlp, citizen_message=row.citizen_message,
        people_estimate=(row.answers or {}).get("people"),
    )
    return d


# Hotspots: DBSCAN over the PostGIS points of open incidents from the last 30 days (UTM 43N, so eps is in
# metres). A hotspot is >= HOTSPOT_MIN_POINTS open incidents chained within HOTSPOT_EPS_M of each other.
# Individual incidents stay separate rows; this only groups them for the authority's attention.
HOTSPOT_EPS_M = 400
HOTSPOT_MIN_POINTS = 3
HOTSPOT_DAYS = 30

HOTSPOT_SQL = f"""
WITH o AS (
  SELECT i.id, i.category_id, i.ward_id, i.priority_score, i.risk, i.affected_count, i.location,
         ST_ClusterDBSCAN(ST_Transform(i.location::geometry, 32643), eps := {HOTSPOT_EPS_M}, minpoints := {HOTSPOT_MIN_POINTS}) OVER () AS cid
  FROM incidents i
  WHERE {open_sql('i')} AND i.created_at > now() - make_interval(days => {HOTSPOT_DAYS})
), c AS (SELECT * FROM o WHERE cid IS NOT NULL)
SELECT c.cid, count(*)::int AS incident_count, max(c.priority_score)::int AS max_priority, sum(c.priority_score)::int AS priority_sum,
       sum(c.affected_count)::int AS affected, (sum(c.affected_count) - count(*))::int AS confirmations,
       count(*) FILTER (WHERE c.risk >= 12)::int AS critical,
       avg(ST_Y(c.location::geometry)) AS lat, avg(ST_X(c.location::geometry)) AS lng,
       array_agg(c.id) AS incident_ids,
       (SELECT count(DISTINCT r.user_id) FROM reports r JOIN c c2 ON c2.id = r.incident_id WHERE c2.cid = c.cid AND r.duplicate_of_report_id IS NULL)::int AS citizens,
       (SELECT w.name FROM c c3 JOIN wards w ON w.id = c3.ward_id WHERE c3.cid = c.cid GROUP BY w.name ORDER BY count(*) DESC, w.name LIMIT 1) AS area,
       (SELECT json_agg(json_build_object('category', cn, 'count', cnt) ORDER BY cnt DESC, cn) FROM
           (SELECT cat.name AS cn, count(*) AS cnt FROM c c4 JOIN categories cat ON cat.id = c4.category_id WHERE c4.cid = c.cid GROUP BY cat.name) q) AS categories
FROM c GROUP BY c.cid
"""


def impact_score(max_priority: int, incident_count: int) -> int:
    """Impact score (0-100) of a hotspot: 60 % the worst incident's priority score, 40 % how many open
    incidents are in the cluster (8 points each, capped at 100). It is a plain formula, not an AI output."""
    return min(100, round(0.6 * max_priority + 0.4 * min(100, 8 * incident_count)))


_hotspot_cache: tuple[float, list[dict]] | None = None


async def hotspots(db: AsyncSession, limit: int = 5) -> list[dict]:
    """DBSCAN hotspots of open incidents (last 30 days), highest impact first. The result is cached in this
    process for HOTSPOT_CACHE_SECONDS: clustering 100k rows takes about a second and the dashboard polls it."""
    global _hotspot_cache
    ttl = get_settings().hotspot_cache_seconds
    if ttl and _hotspot_cache and time.monotonic() - _hotspot_cache[0] < ttl:
        return _hotspot_cache[1][:limit]
    out = []
    for r in (await db.execute(text(HOTSPOT_SQL))).all():
        cats = r.categories or []
        out.append({
            "id": r.cid, "area": r.area or "Outside mapped areas", "incident_count": r.incident_count, "open_incidents": r.incident_count,
            "critical": r.critical, "affected": r.affected, "unique_citizens": r.citizens, "confirmations": r.confirmations,
            "priority_sum": r.priority_sum, "impact_score": impact_score(r.max_priority, r.incident_count),
            "categories": cats, "main_problems": [c["category"] for c in cats[:2]],
            "lat": r.lat, "lng": r.lng, "incident_ids": r.incident_ids,
        })
    out.sort(key=lambda h: (-h["impact_score"], -h["incident_count"], h["id"]))
    _hotspot_cache = (time.monotonic(), out)
    return out[:limit]


# --- Map dashboard -------------------------------------------------------------------------------
# Unsupervised ML: DBSCAN over the PostGIS points of OPEN incidents (UTM 43N, so eps is in metres).
# A cluster = at least CLUSTER_MIN_POINTS open problems within CLUSTER_EPS_M of each other (chained).
# It finds where problems pile up regardless of ward borders; it does not predict anything.
CLUSTER_EPS_M = 300
CLUSTER_MIN_POINTS = 2
MAP_LIMIT = 3000

MAP_SQL = f"""
SELECT i.id, i.public_id, c.name AS category, w.name AS area, i.address_text, i.severity::text AS severity, i.status::text AS status,
       i.priority_score, i.risk, i.due_at, i.assigned_to IS NOT NULL AS assigned, i.affected_count, i.created_at, ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
       (SELECT r.problem_type FROM reports r WHERE r.incident_id = i.id ORDER BY r.created_at LIMIT 1) AS problem_type,
       CASE WHEN {open_sql('i')} THEN
         ST_ClusterDBSCAN(ST_Transform(i.location::geometry, 32643), eps := {CLUSTER_EPS_M}, minpoints := {CLUSTER_MIN_POINTS})
           OVER (PARTITION BY ({open_sql('i')}))
       END AS cid
FROM incidents i JOIN categories c ON c.id = i.category_id LEFT JOIN wards w ON w.id = i.ward_id
ORDER BY i.priority_score DESC, i.created_at DESC
LIMIT {MAP_LIMIT}
"""


def _metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dy, dx = (lat2 - lat1) * 111_320, (lng2 - lng1) * 111_320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


async def map_data(db: AsyncSession) -> dict:
    """Everything the map dashboard draws: every incident with its coordinates, per-area totals, and the
    DBSCAN clusters of open incidents. Read-only; coordinates are the incident's own point."""
    rows = (await db.execute(text(MAP_SQL))).all()
    incidents, by_cluster, by_area = [], {}, {}
    for r in rows:
        is_open = status_mod.is_open(r.status)
        response = response_of(r.risk)[0]
        cluster = int(r.cid) if is_open and r.cid is not None else None
        item = {
            "id": r.id, "public_id": r.public_id, "title": title_of(r.problem_type, r.category, r.address_text), "category": r.category,
            "area": r.area, "severity": r.severity, "status": r.status, "priority_score": r.priority_score, "risk": r.risk, "response": response, "assigned": r.assigned, **due_fields(r.status, r.due_at),
            "affected_count": r.affected_count, "created_at": r.created_at, "lat": r.lat, "lng": r.lng, "cluster": cluster,
        }
        incidents.append(item)
        if cluster is not None:
            by_cluster.setdefault(cluster, []).append(item)
        a = by_area.setdefault(r.area, {"area": r.area, "total": 0, "open": 0, "critical": 0, "resolved": 0, "categories": {}, "lats": [], "lngs": []})
        a["total"] += 1
        a["lats"].append(r.lat)
        a["lngs"].append(r.lng)
        if is_open:
            a["open"] += 1
            a["critical"] += r.risk >= 12
            a["categories"][r.category] = a["categories"].get(r.category, 0) + 1
        else:
            a["resolved"] += 1

    clusters = []
    for cid, members in by_cluster.items():
        lat, lng = sum(m["lat"] for m in members) / len(members), sum(m["lng"] for m in members) / len(members)
        counts: dict[str, int] = {}
        for m in members:
            counts[m["category"]] = counts.get(m["category"], 0) + 1
        top = max(counts, key=lambda k: counts[k])
        areas = sorted({m["area"] for m in members if m["area"]})
        clusters.append({
            "id": cid, "size": len(members), "lat": lat, "lng": lng,
            "radius_m": round(max(_metres(lat, lng, m["lat"], m["lng"]) for m in members) + 60),  # +60 m so a single pair is still visible
            "critical": sum(m["risk"] >= 12 for m in members), "priority_sum": sum(m["priority_score"] for m in members),
            "categories": [{"category": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])],
            "areas": areas, "incident_ids": [m["id"] for m in members],
            "name": f"{top} cluster" + (f" near {areas[0]}" if areas else "") + (f" ({len(members)} open problems)"),
        })
    clusters.sort(key=lambda c: (-c["priority_sum"], c["id"]))
    areas_out = [
        {"area": a["area"] or "Outside mapped areas", "total": a["total"], "open": a["open"], "critical": a["critical"], "resolved": a["resolved"],
         "categories": [{"category": k, "count": v} for k, v in sorted(a["categories"].items(), key=lambda kv: -kv[1])],
         "lat": sum(a["lats"]) / len(a["lats"]), "lng": sum(a["lngs"]) / len(a["lngs"])}
        for a in by_area.values()
    ]
    areas_out.sort(key=lambda a: (-a["critical"], -a["open"], a["area"]))
    return {
        "incidents": incidents, "clusters": clusters, "areas": areas_out, "truncated": len(rows) >= MAP_LIMIT,
        "method": {"name": "DBSCAN (unsupervised clustering)", "engine": "PostGIS ST_ClusterDBSCAN", "eps_m": CLUSTER_EPS_M, "min_points": CLUSTER_MIN_POINTS, "scope": "open incidents only"},
    }


# The facts behind the risk of an incident. ONE query used both to store the score (recompute_priority) and to explain it
# (risk_inputs -> priority.reasons_of), so the stored number and the reasons shown to the officer cannot drift apart.
# *_src says where a fact came from: 'map' (PostGIS on OpenStreetMap), 'citizen' (the reporter's own flag), 'records'
# (other complaints in iREPORT); NULL means the factor does not apply.
INPUTS_SQL = f"""
SELECT i.id, i.created_at, i.status::text AS status, c.name AS category, c.impact AS base_impact, i.citizen_severity::text AS citizen_severity,
  i.flags, i.geo_facts,
  CASE WHEN COALESCE((i.geo_facts->>'checked')::boolean, false) THEN CASE WHEN jsonb_typeof(i.geo_facts->'main_road') = 'object' THEN 'map' END
       WHEN 'Main road' = ANY(i.flags) THEN 'citizen' END AS main_road_src,
  CASE WHEN jsonb_typeof(i.geo_facts->'school') = 'object' OR jsonb_typeof(i.geo_facts->'hospital') = 'object' THEN 'map'
       WHEN 'Near school' = ANY(i.flags) OR 'Near hospital' = ANY(i.flags) THEN 'citizen' END AS sensitive_src,
  CASE WHEN 'Night-time hazard' = ANY(i.flags) THEN 'citizen'
       WHEN EXISTS (SELECT 1 FROM incidents s JOIN categories sc ON sc.id = s.category_id
                    WHERE sc.code = 'streetlight' AND ireport_is_open(s.status) AND ST_DWithin(s.location, i.location, {cfg.STREETLIGHT_RADIUS_M})) THEN 'records' END AS night_src,
  (SELECT count(*) FROM (SELECT user_id FROM reports WHERE incident_id = i.id AND duplicate_of_report_id IS NULL
                         UNION SELECT user_id FROM confirmations WHERE incident_id = i.id) u)::int AS citizens,
  (c.monsoon_sensitive AND extract(month FROM now() AT TIME ZONE 'Asia/Kolkata') IN {cfg.MONSOON_MONTHS}) AS monsoon
FROM incidents i JOIN categories c ON c.id = i.category_id
"""


async def risk_inputs(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Risk facts per incident id (see INPUTS_SQL), as plain dicts for priority.reasons_of()."""
    if not ids:
        return {}
    rows = (await db.execute(text(INPUTS_SQL + " WHERE i.id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in ids]})).mappings().all()
    return {r["id"]: dict(r) for r in rows}


async def recompute_priority(db: AsyncSession, ids: list[uuid.UUID] | None = None) -> int:
    """Recompute risk, the 0-100 sort key and the due date. ids=None refreshes every open incident (the hourly job:
    the month, the citizen count and nearby streetlight complaints change with time). due_at only ever moves EARLIER
    here (LEAST), so a later drop in risk never extends a promise already made; transfers clear it first."""
    where = "i.id = ANY(CAST(:ids AS uuid[]))" if ids is not None else open_sql("i")
    result = await db.execute(
        text(f"""WITH f AS ({INPUTS_SQL} WHERE {where}),
                 r AS (SELECT f.id, ireport_risk(f.base_impact::smallint, f.citizen_severity::severity_level, f.main_road_src IS NOT NULL,
                                                 f.sensitive_src IS NOT NULL, f.citizens, f.monsoon, f.night_src IS NOT NULL) AS risk FROM f)
                 UPDATE incidents i SET risk = r.risk, priority_score = ireport_score(r.risk),
                        due_at = least(i.due_at, i.created_at + ireport_sla_hours(r.risk) * interval '1 hour')
                 FROM r WHERE i.id = r.id
                   AND (i.risk IS DISTINCT FROM r.risk OR i.priority_score IS DISTINCT FROM ireport_score(r.risk) OR i.due_at IS NULL
                        OR i.due_at > i.created_at + ireport_sla_hours(r.risk) * interval '1 hour')"""),
        {"ids": [str(i) for i in ids]} if ids is not None else {},
    )
    return result.rowcount


async def refresh_geo_facts(db: AsyncSession, ids: list[uuid.UUID] | None = None) -> int:
    """Map checks: nearest school / hospital within 100 m and main road within 30 m, by PostGIS against osm_features.
    'checked' is false while no main roads are loaded (load_osm.py not run or failed): the main-road factor then uses the
    citizen's flag. School and hospital use the map when it finds one and the citizen's flag otherwise (labelled as such)."""
    where = "WHERE i.id = ANY(CAST(:ids AS uuid[]))" if ids is not None else ""

    def nearest(kind: str, radius: float, extra: str = "") -> str:
        return f"""(SELECT jsonb_build_object('name', f.name, 'distance_m', round(ST_Distance(f.geom, i.location))::int{extra})
                    FROM osm_features f WHERE f.kind = '{kind}' AND ST_DWithin(f.geom, i.location, {radius})
                    ORDER BY ST_Distance(f.geom, i.location) LIMIT 1)"""

    result = await db.execute(
        text(f"""UPDATE incidents i SET geo_facts = jsonb_build_object(
                   'checked', EXISTS (SELECT 1 FROM osm_features WHERE kind = 'main_road'),
                   'school', {nearest('school', cfg.SENSITIVE_RADIUS_M)},
                   'hospital', {nearest('hospital', cfg.SENSITIVE_RADIUS_M)},
                   'main_road', {nearest('main_road', cfg.MAIN_ROAD_RADIUS_M, ", 'highway', f.highway")}) {where}"""),
        {"ids": [str(i) for i in ids]} if ids is not None else {},
    )
    return result.rowcount


async def resolve_ward(db: AsyncSession, lat: float, lng: float) -> int | None:
    """Ward of the INCIDENT point: PostGIS polygon first, else the nearest seeded area centre.
    The citizen's profile area is never used."""
    ward = await db.scalar(text("SELECT id FROM wards WHERE geom IS NOT NULL AND ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) LIMIT 1"), {"lat": lat, "lng": lng})
    return ward or ref.ward_id(nearest_area(lat, lng))


async def own_open_report(db: AsyncSession, user_id: uuid.UUID, lat: float, lng: float):
    """This user's own report on an OPEN incident within the merge radius, of ANY category, made within the merge age."""
    s = get_settings()
    return (await db.execute(text(f"""
        SELECT i.id, i.public_id, c.name AS category, i.status::text AS status, r.created_at AS reported_at
        FROM reports r JOIN incidents i ON i.id = r.incident_id JOIN categories c ON c.id = i.category_id
        WHERE r.user_id = :u AND r.duplicate_of_report_id IS NULL AND {open_sql('i')}
          AND r.created_at > now() - make_interval(days => :days)
          AND ST_DWithin(i.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)
        ORDER BY i.location <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography LIMIT 1"""),
        {"u": user_id, "lat": lat, "lng": lng, "days": s.merge_max_age_days, "radius": s.merge_radius_m})).first()


async def nearby_check(db: AsyncSession, user_id: uuid.UUID, lat: float, lng: float) -> dict:
    """What the report flow asks right after the location is set: (a) my own open report here, (b) other people's open
    complaints here that I can confirm instead of reporting again. Same 50 m rule as create_report."""
    s = get_settings()
    mine = await own_open_report(db, user_id, lat, lng)
    rows = (await db.execute(text(f"""
        SELECT i.id, i.public_id, c.name AS category, i.status::text AS status, i.affected_count, i.created_at,
               ST_Distance(i.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_m,
               EXISTS (SELECT 1 FROM confirmations f WHERE f.incident_id = i.id AND f.user_id = :u) AS confirmed_by_me,
               (SELECT r.problem_type FROM reports r WHERE r.incident_id = i.id AND r.duplicate_of_report_id IS NULL ORDER BY r.created_at LIMIT 1) AS problem_type,
               i.address_text
        FROM incidents i JOIN categories c ON c.id = i.category_id
        WHERE {open_sql('i')} AND ST_DWithin(i.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)
          AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.incident_id = i.id AND r.user_id = :u AND r.duplicate_of_report_id IS NULL)
        ORDER BY distance_m LIMIT 5"""), {"u": user_id, "lat": lat, "lng": lng, "radius": s.merge_radius_m})).all()
    return {
        "radius_m": s.merge_radius_m,
        "mine": {"id": mine.id, "public_id": mine.public_id, "category": mine.category, "status": mine.status, "reported_at": mine.reported_at} if mine else None,
        "others": [{"id": r.id, "public_id": r.public_id, "category": r.category, "title": title_of(r.problem_type, r.category, r.address_text), "status": r.status,
                    "affected_count": r.affected_count, "distance_m": round(r.distance_m), "confirmed_by_me": r.confirmed_by_me, "created_at": r.created_at} for r in rows],
    }


async def create_report(db: AsyncSession, user_id: uuid.UUID, body: ReportIn) -> dict:
    """Saves one citizen report. A citizen who already has a report on an open complaint within the merge radius (any
    category) gets 409 already_reported and nothing is inserted. Otherwise the report joins an open complaint of the same
    category within the radius and age (section 4), or creates a new one. Runs in the caller's transaction."""
    s = get_settings()
    category = ref.category(body.category)
    if category is None:
        raise ApiError(422, "validation_error", "Unknown category.")
    media_ids = list(dict.fromkeys(body.media_ids))
    if media_ids:
        owned = await db.scalar(
            text("SELECT count(*) FROM media WHERE id = ANY(CAST(:ids AS uuid[])) AND uploader_id = :u AND report_id IS NULL AND incident_id IS NULL"),
            {"ids": [str(m) for m in media_ids], "u": user_id},
        )
        if owned != len(media_ids):
            raise ApiError(422, "invalid_media", "One of the photos was not found. Please add it again.")

    severity, flags = rules.assess(category.name, body.problem_type, body.description, [*body.flags, *flags_from_answers(body.answers)])
    citizen_sev = rules.citizen_severity_for(category.name, body.problem_type, body.description)
    ai_cat: CategoryRef | None = ref.category(body.ai.category) if body.ai and body.ai.category else None
    point = {"lat": body.lat, "lng": body.lng}

    # One citizen's reports are serialised, so two quick taps cannot both pass the duplicate check.
    await db.execute(text("SELECT pg_advisory_xact_lock(4243, hashtext(:u))"), {"u": str(user_id)})
    own = await own_open_report(db, user_id, body.lat, body.lng)
    if own:
        raise ApiError(409, "already_reported", f"You already reported this ({own.public_id}). You can add a photo to it instead.",
                       extra={"id": str(own.id), "public_id": own.public_id, "category": own.category, "status": own.status})

    # Serialise reports per category so two neighbours reporting at the same moment still merge.
    await db.execute(text("SELECT pg_advisory_xact_lock(4242, :c)"), {"c": category.id})
    candidate = await db.scalar(text(f"""
        SELECT id FROM incidents
        WHERE category_id = :c AND {open_sql('incidents')} AND created_at > now() - make_interval(days => :days)
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)
        ORDER BY location <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
        LIMIT 1"""), {**point, "c": category.id, "days": s.merge_max_age_days, "radius": s.merge_radius_m})
    existing = None
    if candidate:
        # Locked separately: FOR UPDATE on a KNN index scan can fail with "attempted to lock invisible tuple".
        existing = (await db.execute(text(f"""
            SELECT id, public_id, severity::text AS severity, citizen_severity::text AS citizen_severity, flags,
                   EXISTS (SELECT 1 FROM confirmations f WHERE f.incident_id = i.id AND f.user_id = :u) AS already_counted
            FROM incidents i WHERE id = :id AND {open_sql('i')} FOR UPDATE"""), {"id": candidate, "u": user_id})).first()

    if existing:
        incident_id, public_id, merged = existing.id, existing.public_id, True
        row = (await db.execute(text("""
            UPDATE incidents SET affected_count = affected_count + :inc, severity = CAST(:sev AS severity_level),
                   citizen_severity = CAST(:csev AS severity_level), flags = CAST(:flags AS text[]), updated_at = now()
            WHERE id = :id RETURNING affected_count, status::text AS status, severity::text AS severity"""), {
            "id": incident_id, "inc": 0 if existing.already_counted else 1,
            "sev": rules.raise_to(existing.severity, severity), "csev": rules.raise_to(existing.citizen_severity, citizen_sev),
            "flags": rules.merge_flags(list(existing.flags), flags),
        })).first()
    else:
        merged = False
        ward_id = await resolve_ward(db, body.lat, body.lng)
        row = (await db.execute(text("""
            INSERT INTO incidents (public_id, category_id, location, ward_id, address_text, severity, citizen_severity, flags)
            VALUES ('IR-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-' || lpad(nextval('incident_public_seq')::text, 5, '0'),
                    :c, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :w, :addr, CAST(:sev AS severity_level), CAST(:csev AS severity_level), CAST(:flags AS text[]))
            RETURNING id, public_id, affected_count, status::text AS status, severity::text AS severity"""), {
            **point, "c": category.id, "w": ward_id, "addr": body.address_text, "sev": severity, "csev": citizen_sev, "flags": flags,
        })).first()
        incident_id, public_id = row.id, row.public_id
        await db.execute(text("INSERT INTO status_events (incident_id, from_status, to_status, actor_id) VALUES (:i, NULL, 'Reported', :u)"), {"i": incident_id, "u": user_id})
        await refresh_geo_facts(db, [incident_id])

    nlp = rules.extract_nlp(body.description, severity, flags)  # computed here, never trusted from the client
    ai = body.ai
    report_id = await db.scalar(text("""
        INSERT INTO reports (incident_id, user_id, problem_type, description, ai_category_id, ai_confidence, model_version, user_corrected,
                             location_source, citizen_message, ai_source, ai_disagreement, nlp, answers)
        VALUES (:i, :u, :p, :d, :ai, :conf, :mv, :corrected, :src, :msg, :ais, CAST(:dis AS jsonb), CAST(:nlp AS jsonb), CAST(:answers AS jsonb)) RETURNING id"""), {
        "i": incident_id, "u": user_id, "p": body.problem_type, "d": body.description or None,
        "ai": ai_cat.id if ai_cat else None, "conf": ai.confidence if ai else None,
        "mv": ai.model_version if ai else None, "corrected": bool(ai_cat and ai_cat.id != category.id),
        "src": body.location_source, "msg": body.citizen_message,
        "ais": ai.source if ai else None, "dis": json.dumps(ai.disagreement) if ai and ai.disagreement else None,
        "nlp": json.dumps(nlp) if nlp else None, "answers": json.dumps(body.answers) if body.answers else None,
    })
    if media_ids:
        await db.execute(text("UPDATE media SET report_id = :r WHERE id = ANY(CAST(:ids AS uuid[])) AND uploader_id = :u AND report_id IS NULL"), {"r": report_id, "ids": [str(m) for m in media_ids], "u": user_id})
    await recompute_priority(db, [incident_id])
    place = (await db.execute(text("SELECT w.name AS area FROM incidents i LEFT JOIN wards w ON w.id = i.ward_id WHERE i.id = :i"), {"i": incident_id})).first()
    return {"report_id": report_id, "incident_id": incident_id, "incident_public_id": public_id, "merged": merged,
            "affected_count": row.affected_count, "severity": row.severity, "status": row.status,
            "area": place.area if place else None, "department": ref.departments.get(category.department_id)}


async def history(db: AsyncSession, incident_ids: list[uuid.UUID], internal: bool = False) -> dict[uuid.UUID, list[dict]]:
    """Status timeline. A row whose from and to status are equal is an internal note (assigned, scheduled, merged):
    only the control room sees it (internal=True), together with who did it."""
    out: dict[uuid.UUID, list[dict]] = {i: [] for i in incident_ids}
    if not incident_ids:
        return out
    rows = await db.execute(text("""
        SELECT e.incident_id, e.from_status::text AS from_status, e.to_status::text AS status, e.created_at, e.reason, u.name AS actor, u.role::text AS actor_role
        FROM status_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.incident_id = ANY(CAST(:ids AS uuid[])) ORDER BY e.created_at, e.id"""), {"ids": [str(i) for i in incident_ids]})
    for r in rows:
        note = r.from_status == r.status
        if note and not internal:
            continue
        item = {"status": r.status, "at": r.created_at, "reason": r.reason}
        if internal:
            item.update(note=note, by=(None if r.actor_role == "citizen" else r.actor), by_role=r.actor_role)
        out[r.incident_id].append(item)
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
