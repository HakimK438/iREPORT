/* Shared types, label lists and small helpers. All data now comes from the iREPORT API (see api.ts). */

export type Role = "citizen" | "authority" | "admin";
export type Status = "Reported" | "Under Review" | "In Progress" | "Resolved";
export type Severity = "Low" | "Medium" | "High" | "Critical";
export type Approval = "pending" | "approved" | "rejected";

export const STATUSES: Status[] = ["Reported", "Under Review", "In Progress", "Resolved"];
export const AREAS = ["Andheri West", "Andheri East", "Bandra", "Colaba", "Fort", "Dadar", "Goregaon", "Malad", "Borivali", "Versova", "Juhu", "Vile Parle", "Santacruz", "Jogeshwari", "Kandivali", "Dahisar", "Mahim", "Sion", "Worli", "Lower Parel", "Byculla", "Malabar Hill", "Kurla", "Ghatkopar", "Chembur", "Powai", "Vikhroli", "Bhandup", "Mulund", "Thane", "Kalyan", "Dombivli", "Navi Mumbai", "Mira Road", "Vasai", "Panvel", "Ulhasnagar", "Bhiwandi"];
export const CATEGORY_NAMES = ["Pothole", "Garbage", "Streetlight", "Water Leakage", "Electrical Hazard", "Other"];
export const DEPARTMENTS = ["Roads & Traffic", "Street Lighting", "Solid Waste Management", "Water Supply", "Storm Water Drains", "Electrical Safety", "General / Ward Office"];

/** Approximate centre of each area, used as the default map pin until the citizen shares a location. */
export const AREA_CENTRES: Record<string, { lat: number; lng: number }> = {
  "Andheri West": { lat: 19.1364, lng: 72.8296 }, Bandra: { lat: 19.0596, lng: 72.8295 }, Colaba: { lat: 18.9067, lng: 72.8147 },
  Fort: { lat: 18.9345, lng: 72.8352 }, Dadar: { lat: 19.0178, lng: 72.8478 }, Goregaon: { lat: 19.1663, lng: 72.8526 },
  Malad: { lat: 19.1874, lng: 72.8484 }, Borivali: { lat: 19.2307, lng: 72.8567 },
  "Andheri East": { lat: 19.1136, lng: 72.8697 }, Versova: { lat: 19.13, lng: 72.812 }, Juhu: { lat: 19.1075, lng: 72.8263 }, "Vile Parle": { lat: 19.0996, lng: 72.8446 },
  Santacruz: { lat: 19.081, lng: 72.842 }, Jogeshwari: { lat: 19.136, lng: 72.849 }, Kandivali: { lat: 19.2043, lng: 72.852 }, Dahisar: { lat: 19.25, lng: 72.859 },
  Mahim: { lat: 19.041, lng: 72.84 }, Sion: { lat: 19.039, lng: 72.8619 }, Worli: { lat: 19.0176, lng: 72.817 }, "Lower Parel": { lat: 18.993, lng: 72.83 },
  Byculla: { lat: 18.978, lng: 72.8333 }, "Malabar Hill": { lat: 18.9548, lng: 72.7985 }, Kurla: { lat: 19.0726, lng: 72.8826 }, Ghatkopar: { lat: 19.086, lng: 72.9081 },
  Chembur: { lat: 19.0522, lng: 72.9005 }, Powai: { lat: 19.1176, lng: 72.906 }, Vikhroli: { lat: 19.11, lng: 72.927 }, Bhandup: { lat: 19.144, lng: 72.938 }, Mulund: { lat: 19.1726, lng: 72.9425 },
  Kalyan: { lat: 19.2437, lng: 73.1355 }, Dombivli: { lat: 19.2183, lng: 73.0868 }, Thane: { lat: 19.2183, lng: 72.9781 }, "Navi Mumbai": { lat: 19.0771, lng: 72.9986 },
  "Mira Road": { lat: 19.2813, lng: 72.8561 }, Vasai: { lat: 19.3919, lng: 72.8397 }, Panvel: { lat: 18.9894, lng: 73.1175 }, Ulhasnagar: { lat: 19.2215, lng: 73.1645 }, Bhiwandi: { lat: 19.3002, lng: 73.0588 },
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
