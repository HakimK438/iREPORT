# TODO later
- Hotspots: DBSCAN is done (map dashboard). Real ward polygons via `scripts/load_wards.py` would replace the nearest-area-centre fallback.
- Map dashboard: not checked in a real browser in this session (build, type-check and API/tests only); the map needs internet for OpenStreetMap tiles.
- Manual location: draggable pin (today: GPS, photo GPS, Nominatim search, or approximate area centre; the OSM embed cannot return coordinates).
- Officer name/contact per ward: needs an "official/public" field on authority profiles.
- Image model: first model shipped (img-1.0, 6 classes). Next: Mumbai photos, data for Water Leakage / Drainage / Electrical Hazard, better not_civic negatives, full fine-tune (ml/train_image.py), independent test set.
- `src/imports/` (Figma export) is not imported anywhere; safe to delete, left untouched as requested.
- Real category photos: place the six files in `public/categories/` (emoji cards show until then).
- Hindi/Marathi: authority/admin screens and AuthPage are English only.
- Nominatim search is called from the browser; add a backend proxy if usage grows.
