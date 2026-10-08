import type { IconName } from "./Icon";

export function Brand() {
  return <div className="brand"><span className="brand-word"><strong>i</strong>REPORT<i /></span><small>METROPOLITAN MUMBAI</small></div>;
}

export const categories = [
  ["Pothole", "road"], ["Road Damage", "reports"], ["Streetlight", "light"], ["Garbage", "waste"],
  ["Water Leakage", "water"], ["Drainage", "map"], ["Electrical Hazard", "bolt"], ["Other", "plus"],
] as [string, IconName][];

/** Home page cards. `file` is looked up in public/categories/; when it is missing the emoji card is shown. */
export const homeCards = [
  { key: "cat_pothole", emoji: "🕳️", file: "pothole.jpg", flow: "Pothole" },
  { key: "cat_garbage", emoji: "🗑️", file: "garbage.jpg", flow: "Garbage" },
  { key: "cat_streetlight", emoji: "💡", file: "streetlight.jpg", flow: "Streetlight" },
  { key: "cat_water", emoji: "💧", file: "water-leakage.jpg", flow: "Water Leakage" },
  { key: "cat_electrical", emoji: "⚡", file: "electrical.jpg", flow: "Electrical Hazard" },
  { key: "cat_other", emoji: "🚧", file: "other.jpg", flow: "Other" },
] as const;

export const statusLabel = (s: string) => (s === "Reported" ? "Pending" : s === "Under Review" ? "Under review" : s === "In Progress" ? "In progress" : s);

export function distanceLabel(m?: number) {
  if (m === undefined) return "";
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m away` : `${(m / 1000).toFixed(1)} km away`;
}
