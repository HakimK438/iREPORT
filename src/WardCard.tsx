import { wardOfArea } from "./wards";

const BASE = import.meta.env.BASE_URL;
const slug = (a: string) => a.toLowerCase().replace(/\s+/g, "-");

/** The BMC ward office behind an area: ward letter, address and telephone (BMC ward list), with the area picture. */
export default function WardCard({ area }: { area: string }) {
  const w = wardOfArea(area);
  if (!w) return null;
  return <div className="ward-card"><img src={`${BASE}areas/${slug(area)}.png`} alt={`${area}`} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
    <div><b>BMC {w.ward} Ward Office · {area}</b><small>{w.address}</small><small>Tel. {w.phone}</small></div></div>;
}
