import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapCluster, MapIncident } from "./api";

/* Colour + size both encode the level, so the map does not rely on colour alone (colour-blind safe). */
export const LEVEL_COLOUR: Record<string, string> = { Critical: "#b3261e", High: "#e8710a", Medium: "#c9a400", Low: "#2e7d6b" };
const LEVEL_RADIUS: Record<string, number> = { Critical: 11, High: 9, Medium: 7, Low: 6 };
const MUMBAI: L.LatLngTuple = [19.07, 72.88];

interface Props { incidents: MapIncident[]; clusters: MapCluster[]; selectedId: string | null; onSelect: (id: string) => void; fitKey: string; showClusters: boolean }

/** Leaflet map of every incident (circle per problem) with the DBSCAN clusters as dashed rings. */
export default function ProblemMap({ incidents, clusters, selectedId, onSelect, fitKey, showClusters }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const lastFit = useRef("");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const highlight = (id: string | null) => {
    markers.current.forEach(mk => mk.setStyle({ color: "#fff", weight: 2 }));
    if (id) markers.current.get(id)?.setStyle({ color: "#12201a", weight: 4 }).bringToFront();
  };

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(MUMBAI, 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  // Redraw the points and rings whenever the data or filter changes.
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers(); markers.current.clear();
    if (showClusters) for (const c of clusters) {
      L.circle([c.lat, c.lng], { radius: c.radius_m, color: "#5b3fa0", weight: 2, dashArray: "6 5", fillColor: "#5b3fa0", fillOpacity: 0.08 })
        .bindTooltip(`${c.name}`, { sticky: true }).addTo(g);
    }
    // Draw low-priority first so critical points end up on top.
    for (const i of [...incidents].reverse()) {
      const resolved = i.status === "Resolved", colour = resolved ? "#8a948f" : LEVEL_COLOUR[i.level];
      const mk = L.circleMarker([i.lat, i.lng], { radius: resolved ? 5 : LEVEL_RADIUS[i.level], color: "#fff", weight: 2, fillColor: colour, fillOpacity: resolved ? 0.6 : 0.92 })
        .bindTooltip(`${i.title} · ${resolved ? "Resolved" : i.level} (${i.priority_score})`)
        .on("click", () => onSelectRef.current(i.id)).addTo(g);
      markers.current.set(i.id, mk);
    }
    highlight(selectedRef.current); // a background refresh rebuilds the points, so keep the selection visible
    // Re-fit only when the area filter changes (or on first data), never on a background refresh.
    if (lastFit.current !== fitKey && incidents.length) {
      lastFit.current = fitKey;
      m.fitBounds(L.latLngBounds(incidents.map(i => [i.lat, i.lng] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 15 });
    }
  }, [incidents, clusters, showClusters, fitKey]);

  // Highlight and centre the selected problem (only when the selection changes, not on every refresh).
  useEffect(() => {
    highlight(selectedId);
    const mk = selectedId ? markers.current.get(selectedId) : undefined;
    if (mk && map.current) map.current.flyTo(mk.getLatLng(), Math.max(map.current.getZoom(), 15), { duration: 0.5 });
  }, [selectedId]);

  return <div ref={el} className="pm-map" role="region" aria-label="Map of civic problems. The same problems are listed as cards below the map." />;
}
