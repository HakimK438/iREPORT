/* Small fetch wrapper for the iREPORT API.
   The access token lives only in memory; the refresh token is an httpOnly cookie set by the API. */

import type { Role, Severity, Status } from "./store";

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

/* ---------- types returned by the API ---------- */

export interface ApiUser { id: string; role: Role; name: string; email: string; phone: string | null; area: string | null; lang: "en" | "hi" | "mr"; department: string | null; employee_id: string | null; approval: "pending" | "approved" | "rejected"; created_at: string }
export interface Session { access_token: string; expires_in: number; user: ApiUser }
export interface Msg { id: number; from: "authority" | "citizen"; by: string; text: string; at: string }
export interface HistoryEvent { status: Status; at: string }
export interface Page<T> { items: T[]; next_cursor: string | null; total?: number | null }

export interface IncidentPublic { id: string; public_id: string; title: string; category: string; area: string | null; address_text: string | null; severity: Severity; status: Status; flags: string[]; affected_count: number; created_at: string; updated_at: string; distance_m?: number; thumb_url: string | null; confirmed_by_me?: boolean; reported_by_me?: boolean }
export interface Nlp { duration: { text: string; days: number } | null; obstruction: string | null; hazard: string[] | null; urgency: string | null; flags: string[] }
export interface AiSummary { category: string | null; confidence: number | null; source: string | null; agreement: "agree" | "disagree" | null; disagreement: { image: string; text: string } | null; user_corrected: boolean }
export interface MyReport { department?: string | null; citizen_message?: string | null; location_source?: string | null; ai?: { category: string | null; confidence: number | null; source: string | null; user_corrected: boolean }; report_id: string; incident_id: string; public_id: string; title: string; category: string; area: string | null; address_text: string | null; severity: Severity; status: Status; affected_count: number; created_at: string; updated_at: string; image_url: string | null; thumb_url: string | null; history: HistoryEvent[]; messages: Msg[] }
export interface AuthorityRow extends IncidentPublic { priority_score: number; level: Severity; reasons: { label: string; pts: number }[]; department: string | null; lat: number | null; lng: number | null; location_source: string | null; ai: AiSummary; nlp: Nlp | null; citizen_message: string | null }
export interface Hotspot { area: string; open_incidents: number; critical: number; affected: number; unique_citizens: number; confirmations: number; priority_sum: number; impact_score: number; categories: { category: string; count: number }[]; main_problems: string[]; lat: number; lng: number }
export interface AdminOverview { unresolved_critical: number; departments: { department: string; open: number; critical: number; resolved: number }[]; categories: { category: string; open: number; share_pct: number; recommended_department: string | null; recommendation: string }[]; hotspots: Hotspot[] }
export interface MapIncident { id: string; public_id: string; title: string; category: string; area: string | null; severity: Severity; status: Status; priority_score: number; level: Severity; affected_count: number; created_at: string; lat: number; lng: number; cluster: number | null }
export interface MapCluster { id: number; size: number; lat: number; lng: number; radius_m: number; critical: number; priority_sum: number; categories: { category: string; count: number }[]; areas: string[]; incident_ids: string[]; name: string }
export interface MapArea { area: string; total: number; open: number; critical: number; resolved: number; categories: { category: string; count: number }[]; lat: number; lng: number }
export interface MapData { incidents: MapIncident[]; clusters: MapCluster[]; areas: MapArea[]; truncated: boolean; method: { name: string; engine: string; eps_m: number; min_points: number; scope: string } }
export interface Contribution { reports_submitted: number; reports_verified: number; confirmations_given: number; category_corrected: number; label: string | null }
export interface GeoResolve { area: string | null; method: "polygon" | "nearest_area_centre"; departments: Record<string, string | null> }
export interface AuthorityDetail extends AuthorityRow { reporters: { name: string; phone: string | null; problem_type: string | null; description: string | null; reported_at: string; ai_category: string | null; ai_confidence: number | null; user_corrected: boolean; ai_source: string | null; ai_disagreement: { image: string; text: string } | null; nlp: Nlp | null; citizen_message: string | null; location_source: string | null }[]; images: { url: string; thumb_url: string }[]; history: HistoryEvent[]; messages: Msg[] }
export interface AuthorityStats { total: number; open: number; in_progress: number; resolved: number; critical_open: number; high_open: number; new_24h: number; per_category: { category: string; total: number; open: number }[]; per_ward: { area: string | null; total: number; open: number }[] }
export interface AdminAuthority { id: string; name: string; email: string; phone: string | null; area: string | null; department: string | null; employee_id: string; approval: "pending" | "approved" | "rejected"; created_at: string; decided_at: string | null }
export interface AdminStats { pending: number; approved: number; rejected: number; citizens: number; incidents: number; reports: number }
export interface PhotoQuality { label: "good" | "blurry" | "dark" | "low resolution"; width: number; height: number; brightness: number; sharpness: number }
export interface Analysis {
  media_ids: string[]; thumb_urls: string[]; category: string | null; confidence: number | null; top3: { category: string; confidence: number }[]; uncertain: boolean; not_civic: boolean;
  disagreement: { image: string; text: string } | null; agreement: "agree" | "disagree" | null; severity: Severity | null; flags: string[]; explanation: string | null;
  gps_suggestion: { lat: number; lng: number } | null; model_version: string | null; source: "image" | "text" | "image+text" | "none";
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
  resolveGeo: (lat: number, lng: number) => request<GeoResolve>(`/geo/resolve${qs({ lat, lng })}`),
  exportMe: () => request<unknown>("/me/export"),
  deleteMe: () => request<void>("/me", { method: "DELETE" }),

  createReport: (body: Record<string, unknown>) => request<ReportCreated>("/reports", { method: "POST", body }),
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
  authorityStats: () => request<AuthorityStats>("/authority/stats"),
  authorityDetail: (id: string) => request<AuthorityDetail>(`/authority/incidents/${id}`),
  authorityUpdate: (id: string, body: { status?: Status; message?: string; flags?: string[] }) => request<unknown>(`/authority/incidents/${id}/update`, { method: "POST", body }),
  authorityBulk: (body: { ids: string[]; status?: Status; message?: string }) => request<{ updated: number }>("/authority/incidents/bulk", { method: "POST", body }),

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
