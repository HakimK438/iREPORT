import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Click-to-pin map for the incident location. The pin is only ever placed by the citizen (tap, drag, GPS or photo GPS). */
export default function LocationPicker({ spot, onPick }: { spot: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  const place = (lat: number, lng: number) => {
    const m = map.current;
    if (!m) return;
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: "pin-icon", html: "<span></span>", iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(m);
      marker.current.on("dragend", () => { const p = marker.current!.getLatLng(); pick.current(p.lat, p.lng); });
    } else marker.current.setLatLng([lat, lng]);
  };

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView([19.076, 72.8777], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    m.on("click", e => { place(e.latlng.lat, e.latlng.lng); pick.current(e.latlng.lat, e.latlng.lng); });
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS / photo GPS / dragging change the spot from outside: move the pin and zoom in.
  useEffect(() => {
    if (!spot || !map.current) return;
    place(spot.lat, spot.lng);
    const at = marker.current!.getLatLng();
    if (Math.abs(at.lat - spot.lat) > 1e-9 || map.current.getZoom() < 15) map.current.setView([spot.lat, spot.lng], Math.max(map.current.getZoom(), 16));
  }, [spot?.lat, spot?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="pick-map" role="application" aria-label="Map. Tap the exact place of the problem to drop a pin; drag the pin to adjust." />;
}
