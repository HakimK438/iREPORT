import { useState } from "react";
import { Icon, type IconName } from "./Icon";

export function Brand() {
  return <div className="brand"><span className="brand-word"><strong>i</strong>REPORT<i /></span><small>METROPOLITAN MUMBAI</small></div>;
}

/** Citizen-facing categories. The values are the internal/API names, which are unchanged. */
export const categories = [
  ["Pothole", "road"], ["Garbage", "waste"], ["Streetlight", "light"],
  ["Water Leakage", "water"], ["Electrical Hazard", "bolt"], ["Other", "plus"],
] as [string, IconName][];

/** Legacy internal categories (kept valid for historical reports) shown under their merged citizen-facing name. */
export const MERGED_CATEGORY: Record<string, string> = { "Road Damage": "Pothole", Drainage: "Water Leakage" };

/** English display labels for internal category names, including the merged legacy ones. */
export const CATEGORY_LABEL: Record<string, string> = {
  Pothole: "Potholes & Road Damage", Garbage: "Garbage & Waste", Streetlight: "Broken Streetlights",
  "Water Leakage": "Water & Drainage", "Electrical Hazard": "Electrical Hazards", Other: "Other Civic Issues",
};
export const categoryLabel = (name: string) => CATEGORY_LABEL[MERGED_CATEGORY[name] ?? name] ?? name;

/** Home page cards. `file` is looked up in public/categories/; when it is missing the emoji card is shown. */
export const homeCards = [
  { key: "cat_pothole", emoji: "🕳️", file: "pothole.jpg", flow: "Pothole", icon: "road", tone: "slate" },
  { key: "cat_garbage", emoji: "🗑️", file: "garbage.jpg", flow: "Garbage", icon: "waste", tone: "green" },
  { key: "cat_streetlight", emoji: "💡", file: "streetlight.jpg", flow: "Streetlight", icon: "light", tone: "amber" },
  { key: "cat_water", emoji: "💧", file: "water-leakage.webp", flow: "Water Leakage", icon: "water", tone: "blue" },
  { key: "cat_electrical", emoji: "⚡", file: "electrical.jpg", flow: "Electrical Hazard", icon: "bolt", tone: "red" },
  { key: "cat_other", emoji: "🚧", file: "other.avif", flow: "Other", icon: "plus", tone: "violet" },
] as const satisfies readonly { key: string; emoji: string; file: string; flow: string; icon: IconName; tone: string }[];

export const statusLabel = (s: string) => (s === "Reported" ? "Pending" : s === "Acknowledged" ? "Acknowledged" : s === "In Progress" ? "In progress" : s);

export function distanceLabel(m?: number) {
  if (m === undefined) return "";
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m away` : `${(m / 1000).toFixed(1)} km away`;
}

/** Stock picture for a category (public/categories). Used wherever a report has no photo of its own, so a card is never blank. */
export function CategoryPhoto({ category, className = "cat-photo", label = true }: { category: string; className?: string; label?: boolean }) {
  const [ok, setOk] = useState(true);
  const name = MERGED_CATEGORY[category] ?? category;
  const card = homeCards.find(c => c.flow === name) ?? homeCards[homeCards.length - 1];
  return <span className={className} data-tone={card.tone}>
    {ok ? <img src={`${import.meta.env.BASE_URL}categories/${card.file}`} alt={categoryLabel(category)} loading="lazy" onError={() => setOk(false)} /> : <Icon name={card.icon} size={30} />}
    {label && <small>{categoryLabel(category)}</small>}
  </span>;
}
