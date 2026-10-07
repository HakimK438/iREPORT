import type { IconName } from "./Icon";

export function Brand() {
  return <div className="brand"><span className="brand-word"><strong>i</strong>REPORT<i /></span><small>METROPOLITAN MUMBAI</small></div>;
}

export const categories = [
  ["Pothole", "road"], ["Road Damage", "reports"], ["Streetlight", "light"], ["Garbage", "waste"],
  ["Water Leakage", "water"], ["Drainage", "map"], ["Electrical Hazard", "bolt"], ["Other", "plus"],
] as [string, IconName][];

export const problems: Record<string, string[]> = {
  Pothole: ["Small", "Medium", "Large", "Multiple potholes", "Dangerous road condition"],
  Streetlight: ["Not working", "Flickering", "Broken pole", "Damaged wiring"],
  Garbage: ["Overflowing", "Illegal dumping", "Uncollected garbage"],
};

export const photos = {
  hero: "https://images.unsplash.com/photo-1728325444171-088ccff86658?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=88&w=1400",
  road: "https://images.unsplash.com/photo-1684588744065-235ea5065b2b?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=86&w=1000",
  city: "https://images.unsplash.com/photo-1665570124900-2eba10b696f0?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=86&w=1000",
};

export const statusLabel = (s: string) => (s === "Reported" ? "Pending" : s === "Under Review" ? "Under review" : s === "In Progress" ? "In progress" : s);

export function distanceLabel(m?: number) {
  if (m === undefined) return "";
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m away` : `${(m / 1000).toFixed(1)} km away`;
}
