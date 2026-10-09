/* Small fetch wrapper for the iREPORT API.
   The access token lives only in memory; the refresh token is an httpOnly cookie set by the API. */

import type { ResponseCat, Role, Severity, Status } from "./store";

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000/api/v1").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(fn: () => void) { onSessionLost = fn; }
export function setToken(token: string | null) { accessToken = token; }

type Options = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal; retry?: boolean };

async function raw<T>(path: string, { method = "GET", body, form, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), credentials: "include", signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Cannot reach iREPORT right now. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Something went wrong. Please try again.");
  return data as T;
}

/** Calls the API; on a 401 it refreshes the session once (shared by parallel requests) and retries. */
export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  try {
    return await raw<T>(path, opts);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || opts.retry === false || path.startsWith("/auth/")) throw e;
    const session = await refreshSession();
    if (!session) { onSessionLost?.(); throw e; }
    return raw<T>(path, opts);
  }
}

export function refreshSession(): Promise<Session | null> {
  const attempt = () => raw<Session>("/auth/refresh", { method: "POST" });
  refreshing ??= attempt()
    // Another tab refreshed with the same cookie a moment ago; the new cookie is already in the jar.
    .catch(e => (e instanceof ApiError && e.code === "refresh_race" ? new Promise<void>(r => window.setTimeout(r, 300)).then(attempt) : Promise.reject(e)))
    .then(s => { accessToken = s.access_token; return s; })
    .catch(() => { accessToken = null; return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** Downloads the filtered complaint list as CSV (a plain link cannot send the Authorization header). */
export async function downloadCsv(params: Record<string, string | undefined>): Promise<void> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const res = await fetch(`${BASE}/authority/analytics/export.csv?${q}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, "export_failed", "Could not export the list. Please try again.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = "complaints.csv"; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- types returned by the API ---------- */

export interface ApiUser { id: string; role: Role; name: string; email: string; phone: string | null; area: string | null; lang: "en" | "hi" | "mr"; department: string | null; employee_id: string | null; approval: "pending" | "approved" | "rejected"; created_at: string }
export interface Session { access_token: string; expires_in: number; user: ApiUser }
export interface Msg { id: number; from: "authority" | "citizen"; by: string; text: string; at: string }
export interface HistoryEvent { status: Status; at: string; reason?: string | null; note?: boolean; by?: string | null }
export interface Page<T> { items: T[]; next_cursor: string | null; total?: number | null }

export interface IncidentPublic { citizens?: number; id: string; public_id: string; title: string; category: string; area: string | null; address_text: string | null; severity: Severity; status: Status; flags: string[]; affected_count: number; created_at: string; updated_at: string; distance_m?: number; thumb_url: string | null; sample_confidence?: number | null; confirmed_by_me?: boolean; reported_by_me?: boolean }
export interface Nlp { duration: { text: string; days: number } | null; obstruction: string | null; hazard: string[] | null; urgency: string | null; flags: string[] }
export interface AiSummary { category: string | null; confidence: number | null; source: string | null; agreement: "agree" | "disagree" | null; disagreement: { image: string; text: string } | null; user_corrected: boolean }
export interface MyReport { photo_count?: number; max_photos?: number; reopen_count?: number; can_respond?: boolean; closes_at?: string | null; department?: string | null; citizen_message?: string | null; location_source?: string | null; ai?: { category: string | null; confidence: number | null; source: string | null; user_corrected: boolean }; report_id: string; incident_id: string; public_id: string; title: string; category: string; area: string | null; address_text: string | null; severity: Severity; status: Status; affected_count: number; created_at: string; updated_at: string; image_url: string | null; thumb_url: string | null; history: HistoryEvent[]; messages: Msg[] }
export interface Assignee { id: string; name: string }
export interface AuthorityRow extends IncidentPublic {
  priority_score: number; risk: number; response: ResponseCat; response_hours: number; due_at: string | null; overdue: boolean; overdue_days: number;
  scheduled_for: string | null; reopen_count: number; status_reason: string | null; assignee: Assignee | null; people_estimate: string | null;
  department: string | null; lat: number | null; lng: number | null; location_source: string | null; ai: AiSummary; nlp: Nlp | null; citizen_message: string | null;
}
export interface Hotspot { id: number; incident_count: number; incident_ids: string[]; area: string; open_incidents: number; critical: number; affected: number; unique_citizens: number; confirmations: number; priority_sum: number; impact_score: number; categories: { category: string; count: number }[]; main_problems: string[]; lat: number; lng: number }
export interface AdminOverview { unresolved_critical: number; departments: { department: string; open: number; critical: number; resolved: number }[]; categories: { category: string; open: number; share_pct: number; recommended_department: string | null; recommendation: string }[]; hotspots: Hotspot[] }
export interface MapIncident { id: string; public_id: string; title: string; category: string; area: string | null; severity: Severity; status: Status; priority_score: number; risk: number; response: ResponseCat; due_at: string | null; overdue: boolean; overdue_days: number; assigned: boolean; affected_count: number; created_at: string; lat: number; lng: number; cluster: number | null }
export interface MapCluster { id: number; size: number; lat: number; lng: number; radius_m: number; critical: number; priority_sum: number; categories: { category: string; count: number }[]; areas: string[]; incident_ids: string[]; name: string }
export interface MapArea { area: string; total: number; open: number; critical: number; resolved: number; categories: { category: string; count: number }[]; lat: number; lng: number }
export interface MapData { incidents: MapIncident[]; clusters: MapCluster[]; areas: MapArea[]; truncated: boolean; method: { name: string; engine: string; eps_m: number; min_points: number; scope: string } }
export interface Summary { reports_submitted: number; incidents_resolved: number; confirmations_received: number; level: "contributor" | "trusted" | null }
export interface Contribution { reports_submitted: number; reports_verified: number; confirmations_given: number; category_corrected: number; label: string | null }
export interface GeoResolve { area: string | null; method: "polygon" | "nearest_area_centre"; departments: Record<string, string | null> }
export type Source = "map" | "citizen" | "records" | "calendar" | "category";
export interface Reason { code: string; source: Source; params: { category?: string; name?: string | null; kind?: string; distance_m?: number | null; n?: number } }
export interface EvidenceEntry { reporter: string; phone: string | null; at: string; problem_type: string | null; description: string | null; citizen_message: string | null; photos: { url: string; thumb_url: string }[] }
export interface Near { kind: "school" | "hospital"; name: string | null; distance_m: number }
export interface Brief extends AuthorityRow {
  reasons: Reason[]; map_checked: boolean; duplicate_of: string | null;
  what: { problem: string | null; category: string; address: string | null; near: Near | null };
  where: { address: string | null; area: string | null; lat: number; lng: number; point_source: string | null };
  evidence: EvidenceEntry[];
  history_here: { count: number; days: number; radius_m: number; since: string | null; items: { public_id: string; status: Status; created_at: string; resolved_at: string | null }[] };
  nearby_open: { count: number; radius_m: number; items: { id: string; public_id: string; category: string; status: Status; distance_m: number }[] };
  timeline: HistoryEvent[]; messages: Msg[];
}
export type AuthorityDetail = Brief;
export type ChipId = "all" | "new" | "acknowledged" | "scheduled" | "in_progress" | "resolved" | "closed" | "overdue" | "unassigned";
export interface AuthorityStats {
  total: number; open: number; overdue: number; unassigned: number; due_today: number; emergency_open: number; urgent_open: number; new_24h: number;
  by_status: Record<string, number>; chips: Record<ChipId, number>;
  per_category: { category: string; total: number; open: number }[]; per_ward: { area: string | null; total: number; open: number }[];
}
export interface Officer { id: string; name: string; department: string | null; ward: string | null; is_me: boolean }
export interface NearbyCheck { radius_m: number; mine: { id: string; public_id: string; category: string; status: Status; reported_at: string } | null; others: { id: string; public_id: string; category: string; title: string; status: Status; affected_count: number; distance_m: number; confirmed_by_me: boolean }[] }
export interface UpdateBody {
  status?: Status; message?: string; flags?: string[]; reason?: string; duplicate_of?: string; category?: string; assigned_to?: string; scheduled_for?: string;
}
export interface AdminAuthority { id: string; name: string; email: string; phone: string | null; area: string | null; department: string | null; employee_id: string; approval: "pending" | "approved" | "rejected"; created_at: string; decided_at: string | null }
export interface AdminStats { pending: number; approved: number; rejected: number; citizens: number; incidents: number; reports: number }
export interface PhotoQuality { label: "good" | "blurry" | "dark" | "low resolution"; width: number; height: number; brightness: number; sharpness: number }
/** One photo judged against the category the citizen chose. `matches: false` only when the image model is confident it shows something else. */
export interface PhotoCheck { index: number; media_id: string; thumb_url: string; looks_like: string; confidence: number; matches: boolean }
export interface Analysis {
  media_ids: string[]; thumb_urls: string[]; category: string | null; confidence: number | null; top3: { category: string; confidence: number }[]; uncertain: boolean; not_civic: boolean;
  disagreement: { image: string; text: string } | null; agreement: "agree" | "disagree" | null; severity: Severity | null; flags: string[]; explanation: string | null;
  gps_suggestion: { lat: number; lng: number } | null; model_version: string | null; source: "image" | "text" | "image+text" | "none";
  image_confidence: number | null; text_confidence: number | null; image_model_active: boolean; department: string | null;
  photo_checks?: PhotoCheck[];
  ai_available: boolean; models: { image: string; text: string }; photo_quality: PhotoQuality[]; photo_errors: { index: number; code: string; message: string }[]; nlp: Nlp | null;
}
export interface ReportCreated { report_id: string; incident_id: string; incident_public_id: string; merged: boolean; affected_count: number; severity: Severity; status: Status; area: string | null; department: string | null }

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/* ---------- endpoints ---------- */

export const api = {
  login: (email: string, password: string, role: Role) => request<Session>("/auth/login", { method: "POST", body: { email, password, role } }),
  register: (body: Record<string, unknown>) => request<Session | { pending: true; message: string }>("/auth/register", { method: "POST", body }),
  logout: () => request<void>("/auth/logout", { method: "POST" }).catch(() => undefined),
  me: () => request<ApiUser>("/me"),
  patchMe: (body: Partial<Pick<ApiUser, "name" | "phone" | "area" | "lang">>) => request<ApiUser>("/me", { method: "PATCH", body }),
  contribution: () => request<Contribution>("/me/contribution"),
  summary: () => request<Summary>("/me/summary"),
  resolveGeo: (lat: number, lng: number) => request<GeoResolve>(`/geo/resolve${qs({ lat, lng })}`),
  exportMe: () => request<unknown>("/me/export"),
  deleteMe: () => request<void>("/me", { method: "DELETE" }),

  createReport: (body: Record<string, unknown>) => request<ReportCreated>("/reports", { method: "POST", body }),
  nearbyCheck: (lat: number, lng: number) => request<NearbyCheck>(`/reports/nearby-check${qs({ lat, lng })}`),
  addPhotos: (incidentId: string, form: FormData) => request<{ added: number; photos_total: number }>(`/reports/${incidentId}/photos`, { method: "POST", form }),
  confirmFixed: (id: string) => request<{ status: Status }>(`/incidents/${id}/resolution/confirm`, { method: "POST" }),
  reopen: (id: string, reason: string) => request<{ status: Status }>(`/incidents/${id}/resolution/reopen`, { method: "POST", body: { reason } }),
  myReports: (cursor?: string) => request<Page<MyReport>>(`/reports/mine${qs({ cursor })}`),
  nearby: (p: { lat: number; lng: number; radius: number; category?: string; status?: string; sort: string; cursor?: string }) => request<Page<IncidentPublic>>(`/incidents/nearby${qs(p)}`),
  confirm: (id: string) => request<{ confirmed: boolean; affected_count: number }>(`/incidents/${id}/confirm`, { method: "POST" }),
  unconfirm: (id: string) => request<{ confirmed: boolean; affected_count: number }>(`/incidents/${id}/confirm`, { method: "DELETE" }),
  reply: (id: string, body: string) => request<Msg>(`/incidents/${id}/messages`, { method: "POST", body: { body } }),
  unread: () => request<{ unread: number }>("/messages/unread-count"),

  authorityList: (p: Record<string, string | number | boolean | undefined>) => request<Page<AuthorityRow>>(`/authority/incidents${qs(p)}`),
  hotspots: (limit = 5) => request<{ items: Hotspot[] }>(`/authority/hotspots${qs({ limit })}`),
  adminOverview: () => request<AdminOverview>("/admin/overview"),
  authorityMap: () => request<MapData>("/authority/map"),
  adminMap: () => request<MapData>("/admin/map"),
  adminIncident: (id: string) => request<AuthorityDetail>(`/admin/incidents/${id}`),
  authorityStats: (p: Record<string, string | undefined> = {}) => request<AuthorityStats>(`/authority/stats${qs(p)}`),
  officers: () => request<{ items: Officer[] }>("/authority/officers"),
  authorityDetail: (id: string) => request<AuthorityDetail>(`/authority/incidents/${id}`),
  authorityUpdate: (id: string, body: UpdateBody) => request<{ status: Status }>(`/authority/incidents/${id}/update`, { method: "POST", body }),
  authorityBulk: (body: { ids: string[]; status?: "Acknowledged" | "Scheduled" | "Resolved"; message?: string; assigned_to?: string; scheduled_for?: string }) =>
    request<{ updated: number; skipped: { id: string; code: string; message: string }[] }>("/authority/incidents/bulk", { method: "POST", body }),

  adminAuthorities: (approval?: string) => request<AdminAuthority[]>(`/admin/authorities${qs({ approval })}`),
  adminDecide: (id: string, decision: "approve" | "reject" | "revoke") => request<AdminAuthority>(`/admin/authorities/${id}/decision`, { method: "POST", body: { decision } }),
  adminStats: () => request<AdminStats>("/admin/stats"),
};

/** POST /ai/analyze with upload progress. The 8 s AI timeout starts once the upload has finished,
    so a slow uplink is not mistaken for a slow model. */
export function analyze(form: FormData, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Analysis> {
  const send = (): Promise<Analysis> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/ai/analyze`);
    xhr.withCredentials = true;
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    let timer = 0;
    const fail = (e: ApiError) => { window.clearTimeout(timer); reject(e); };
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => { onProgress(1); timer = window.setTimeout(() => { xhr.abort(); fail(new ApiError(0, "timeout", "iREPORT took too long to analyse this.")); }, 8000); };
    xhr.onerror = () => fail(new ApiError(0, "network", "The upload failed. Check your connection and try again."));
    xhr.onload = () => {
      window.clearTimeout(timer);
      let data: { error?: { code: string; message: string } } | null = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as Analysis);
      else reject(new ApiError(xhr.status, data?.error?.code ?? "error", data?.error?.message ?? "Upload failed."));
    };
    signal?.addEventListener("abort", () => { xhr.abort(); fail(new ApiError(0, "aborted", "Cancelled.")); });
    xhr.send(form);
  });
  return send().catch(async (e: ApiError) => {
    if (e.status !== 401) throw e;
    if (!(await refreshSession())) { onSessionLost?.(); throw e; }
    return send();
  });
}

/* ---------- analytics (authority only) ---------- */
export interface AnOverview { open: number; overdue: number; resolved_week: number; total: number; resolved_total: number; median_days_to_close: number | null; pct_within_sla: number | null; pct_reopened: number | null }
export interface AnBacklog { weeks: { week: string; reported: number; closed: number; open_at_end: number }[] }
export interface AnWard { items: { ward: string; total: number; open: number; overdue: number; median_days_to_close: number | null; lat: number | null; lng: number | null }[] }
export interface AnType { items: { category: string; total: number; open: number; median_days_to_close: number | null; repeat_spots: number }[]; trend: { category: string; this_month: number; last_month: number }[]; repeat_days: number; repeat_radius_m: number; repeats: { public_id: string; category: string; ward: string | null; previous: string; days_after: number }[] }
export interface AnPerformance { departments: { name: string; resolved: number; pct_within_sla: number; reopen_rate: number }[]; wards: { name: string; resolved: number; pct_within_sla: number; reopen_rate: number }[] }
export interface AnSeason { items: { month: string; category: string; n: number }[] }
export interface AnToday { new_today: number; closed_today: number; overdue: number; ward: string | null }
export type AnFilters = Record<string, string | undefined>;
export const analytics = {
  overview: (p: AnFilters) => request<AnOverview>(`/authority/analytics/overview${qs(p)}`),
  backlog: (p: AnFilters) => request<AnBacklog>(`/authority/analytics/backlog${qs(p)}`),
  byWard: (p: AnFilters) => request<AnWard>(`/authority/analytics/by-ward${qs(p)}`),
  byType: (p: AnFilters) => request<AnType>(`/authority/analytics/by-type${qs(p)}`),
  performance: (p: AnFilters) => request<AnPerformance>(`/authority/analytics/performance${qs(p)}`),
  season: (p: AnFilters) => request<AnSeason>(`/authority/analytics/season${qs(p)}`),
  today: (p: AnFilters) => request<AnToday>(`/authority/analytics/today${qs(p)}`),
};
