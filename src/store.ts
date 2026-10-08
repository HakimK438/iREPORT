/* Shared types, label lists and small helpers. All data now comes from the iREPORT API (see api.ts). */

export type Role = "citizen" | "authority" | "admin";
export type Status = "Reported" | "Under Review" | "In Progress" | "Resolved";
export type Severity = "Low" | "Medium" | "High" | "Critical";
export type Approval = "pending" | "approved" | "rejected";

export const STATUSES: Status[] = ["Reported", "Under Review", "In Progress", "Resolved"];
export const AREAS = ["Andheri West", "Bandra", "Colaba", "Fort", "Dadar", "Goregaon", "Malad", "Borivali"];
export const CATEGORY_NAMES = ["Pothole", "Garbage", "Streetlight", "Water Leakage", "Electrical Hazard", "Other"];
export const DEPARTMENTS = ["Roads & Traffic", "Street Lighting", "Solid Waste Management", "Water Supply", "Storm Water Drains", "Electrical Safety", "General / Ward Office"];

/** Approximate centre of each area, used as the default map pin until the citizen shares a location. */
export const AREA_CENTRES: Record<string, { lat: number; lng: number }> = {
  "Andheri West": { lat: 19.1364, lng: 72.8296 }, Bandra: { lat: 19.0596, lng: 72.8295 }, Colaba: { lat: 18.9067, lng: 72.8147 },
  Fort: { lat: 18.9345, lng: 72.8352 }, Dadar: { lat: 19.0178, lng: 72.8478 }, Goregaon: { lat: 19.1663, lng: 72.8526 },
  Malad: { lat: 19.1874, lng: 72.8484 }, Borivali: { lat: 19.2307, lng: 72.8567 },
};

export function ago(ts: number | string): string {
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
