# Open items

Open items after the authority v2 work. Each line says what is missing and why.

- **Map checks from OpenStreetMap:** `python -m scripts.load_osm` is written but the Overpass download failed during the last build. Run it again; until then "near a school" and "on a main road" use the citizen's flags, labelled "citizen says".
- **Real ward boundaries:** load polygons with `scripts/load_wards.py`; today an area is the nearest of the seeded area centres.
- **Location pictures and symbols:** the files in `public/areas` and `public/symbols` have no licence record, and `critical.png` carries a stock-site watermark. Confirm the licences or replace them. `andheri-east.png` is 1.9 MB and should be compressed.
- **Area picture script:** an automated fetch of freely licensed area pictures with credits was not built.
- **Browser check of officer actions:** assign, schedule, hold, reject, duplicate, transfer, bulk actions and the citizen confirm / reopen buttons are covered by API tests but were not clicked through by a person. Follow the manual test script in `REVIEW_AUTHORITY_V2.md`.
- **Hindi and Marathi:** all new text was machine-written and needs review by native speakers (see `docs/I18N_REVIEW.md`).
- **Live-wire scoring:** a single live-wire report with nothing else known scores 4 x 1 (MODERATE RISK). Decide on a floor for impact 4 (DECISIONS.md entry 69).
- **Unused table:** `resolution_proofs` (migration 0011) is no longer used after proof of resolution was removed; drop it in a new migration if not needed.
- **Image model:** six classes only; needs real Mumbai photos and data for water leakage, drainage and electrical hazards.
- **Performance:** photo analysis and the 100,000-incident list were measured on an earlier build; re-measure on the real server with `scripts/bench.py`.
- **Old import folder:** `src/imports/` (a Figma export) is not imported anywhere and causes the one remaining type-check error; it can be deleted.
- **Admin weights page:** a screen to edit the risk configuration was not built; the numbers live in `backend/app/risk_config.py`.
- **Nominatim:** place search runs from the browser; add a backend proxy if usage grows.

---

