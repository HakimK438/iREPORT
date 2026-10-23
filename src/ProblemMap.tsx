import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AreaOutline, MapArea, MapCluster, MapIncident } from "./api";
import { AREA_CENTRES, isOpen } from "./store";
import { tr, type Lang, type StrKey } from "./i18n";

/* Colour + size both encode the level, so the map does not rely on colour alone (colour-blind safe). */
export const LEVEL_COLOUR: Record<string, string> = { Emergency: "#b3261e", Urgent: "#e8710a", Routine: "#c9a400", Planned: "#2e7d6b" };
const LEVEL_RADIUS: Record<string, number> = { Emergency: 11, Urgent: 9, Routine: 7, Planned: 6 };
const MUMBAI: L.LatLngTuple = [19.07, 72.88];

interface Props { lang: Lang; incidents: MapIncident[]; clusters: MapCluster[]; areas: MapArea[]; selectedId: string | null; onSelect: (id: string) => void; fitKey: string; showClusters: boolean; outline?: AreaOutline | null }

/** GeoJSON [lng, lat] rings to Leaflet [lat, lng] rings, for a Polygon or MultiPolygon. */
const toLatLngPolygons = (g: AreaOutline["geometry"]): L.LatLngTuple[][][] => {
  const polys = (g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]));
  return polys.map(poly => poly.map(ring => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)));
};

/** Leaflet map of every incident (circle per problem) with the DBSCAN clusters as dashed rings.
    With `outline` (an area authority's own map) the border of its BMC ward is drawn as a thin line. */
export default function ProblemMap({ lang, incidents, clusters, areas, selectedId, onSelect, fitKey, showClusters, outline }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const outlineLayer = useRef<L.LayerGroup | null>(null);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const markers = useRef(new Map<string, L.CircleMarker>());
  const labels = useRef<L.LayerGroup | null>(null);
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
    outlineLayer.current = L.layerGroup().addTo(m); // below the points, so the border never hides a problem
    layer.current = L.layerGroup().addTo(m);
    labels.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  // The authority's ward: just its border, as a thin line (no shading), and zoom to it.
  useEffect(() => {
    const m = map.current, g = outlineLayer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (!outline) return;
    const border = L.polygon(toLatLngPolygons(outline.geometry), { color: "#126b50", weight: 2, opacity: 0.9, fill: false, interactive: false }).addTo(g);
    m.fitBounds(border.getBounds(), { padding: [24, 24] });
  }, [outline]);

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
      const resolved = !isOpen(i.status), colour = resolved ? "#8a948f" : LEVEL_COLOUR[i.response];
      const mk = L.circleMarker([i.lat, i.lng], { radius: resolved ? 5 : LEVEL_RADIUS[i.response], color: "#fff", weight: 2, fillColor: colour, fillOpacity: resolved ? 0.6 : 0.92 })
        .bindTooltip(`${i.title} · ${resolved ? i.status : tr(lang, `resp_${i.response}` as StrKey)}`)
        .on("click", () => onSelectRef.current(i.id)).addTo(g);
      markers.current.set(i.id, mk);
    }
    highlight(selectedRef.current); // a background refresh rebuilds the points, so keep the selection visible
    // Re-fit only when the area filter changes (or on first data), never on a background refresh. With an outline the map stays on the area.
    if (lastFit.current !== fitKey && incidents.length && !outlineRef.current) {
      lastFit.current = fitKey;
      m.fitBounds(L.latLngBounds(incidents.map(i => [i.lat, i.lng] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 15 });
    }
  }, [incidents, clusters, showClusters, fitKey, lang]);

  // Area name labels (Sion, Bandra, Ulhasnagar, ...): every seeded area at street-level zoom, only areas with open complaints when zoomed out.
  useEffect(() => {
    const m = map.current, g = labels.current;
    if (!m || !g) return;
    const withOpen = new Set(areas.filter(a => a.open > 0).map(a => a.area));
    const draw = () => {
      g.clearLayers();
      const z = m.getZoom();
      for (const [name, c] of Object.entries(AREA_CENTRES)) {
        if (outline && name !== outline.area) continue; // an area authority's map names only its own area
        if (z < 12 && !withOpen.has(name)) continue;
        if (z < 10) continue;
        L.marker([c.lat, c.lng], { interactive: false, keyboard: false, icon: L.divIcon({ className: "area-label", html: `<span>${name}</span>`, iconSize: [0, 0] }) }).addTo(g);
      }
    };
    draw();
    m.on("zoomend", draw);
    return () => { m.off("zoomend", draw); };
  }, [areas, outline]);

  // Highlight and centre the selected problem (only when the selection changes, not on every refresh).
  useEffect(() => {
    highlight(selectedId);
    const mk = selectedId ? markers.current.get(selectedId) : undefined;
    if (mk && map.current) map.current.flyTo(mk.getLatLng(), Math.max(map.current.getZoom(), 15), { duration: 0.5 });
  }, [selectedId]);

  return <div ref={el} className="pm-map" role="region" aria-label="Map of civic problems. The same problems are listed as cards below the map." />;
}
