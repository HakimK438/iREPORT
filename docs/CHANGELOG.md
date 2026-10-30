# Changelog

#  v5

- **One ward login.** The Authority log-in tab has a single ward list. Choosing a ward shows its BMC ward-office picture, address and phone; on the development server it also fills in that ward's seeded email and password (production builds ship no credentials). The old per-area switch tabs are gone.
- **Admin-set response times.** The admin panel has four sliders (Critical, High risk, Moderate risk, Routine) for the days each level gets before a complaint is overdue. Saving recalculates the due date of every open complaint (migration `0019_response_settings`, `GET/PUT /admin/response-times`). Some static help text still quotes the default 1 / 3 / 14 / 30 days.
- **Ward pictures** for 14 areas were replaced with Wikimedia Commons photos (credits below).

##  v3

- **Area-wise officers.** Officers see and change only their own area and department (enforced on the server). Area tabs at the top of the Control room switch authority by signing in as that area's authority. Each tab shows the BMC ward office (ward letter, address, telephone, from the BMC ward list).
- **No manual assigning.** The area authority is responsible; the officer who acts on a complaint becomes its owner. The next action is always one button: Acknowledge, Start work, Mark resolved.
- **Safer resolving.** A completion note is required and is shown to the citizen. Bulk resolve is refused.
- **Up to three problems at one place,** with a clear **Main problem** and **Other problems** section. Officers see which one was the main problem.
- **Photo checks.** A new image model (`img-2.0`) recognises electrical hazards and drainage. A photo the model is sure is wrong is refused; a doubtful one flags the report "Potentially fake / needs review". Every complaint shows a one-line image check.
- **Plain priority.** A "Top recommended problems" key explains Critical, High risk, Moderate risk and Routine with the fix-by time, and each complaint explains how its deadline was worked out.
- **Calmer interface.** White cards with a thin border, only the priority label carries colour, a shorter complaint view with a "More details" fold, a professional footer, and a minimal landing header.
- **Admin dashboard.** Eight summary cards, a weekly workload line chart, priority, problem-type and area bars, a department table, ranked hotspots, officer workload and printable report, all counted straight from the records.
- **Area-only analysis.** An officer's Analysis tab covers their own area and starts with plain-language findings.
- **A "How it works" page** for officers and admins with screenshots, in English, Hindi and Marathi.
- **Demo data on real streets.** Seed scripts add complaints with relevant CivicFix photos, placed on real road points from OpenStreetMap so none sits in the sea.

---

##  v4

- **Official ward boundaries.** The 24 BMC ward polygons (DataMeet, CC BY-SA 2.5 IN, `backend/app/data/bmc_wards.geojson`) decide an incident's area (migration 0017). Each ward is split between its areas by a Voronoi diagram of the area centres, so the areas of a ward tile it exactly. Four wards had no area (B, C, F/S, M/E): Dongri, Kalbadevi, Parel and Govandi were added. Prabhadevi is officially ward G/North, so it belongs to the Dadar authority. An area authority's map draws its own outline and dims everything outside it.
- **Community after a report.** After sending a report the citizen lands on the Community page around the place just reported, sees what others reported there (first name and last initial of the first reporter, "+N others") and can upvote.
- **No credentials on screen.** The demo-account box and the pre-filled ward logins are gone.
- **Proof of work to resolve (migration 0018).** An officer cannot mark a complaint Resolved without a photo taken at the site: the phone's GPS must be within 150 m (`PROOF_RADIUS_M`) with a precise fix, the photo's own GPS and capture time (when it has them) must agree, and the photo must not have been used before. The citizen sees the photo and confirms or reopens. A fix marked resolved less than 20 minutes after the officer's last action, or with no earlier action, is flagged. Set `REQUIRE_RESOLUTION_PROOF=false` in `.env` only for a demo on a laptop that is not at the complaint.
- **Abuse checks on reports.** The same photo (perceptual hash) cannot back two reports; a photo whose GPS is far from the pinned spot sends the report to review; 25 reports a day per citizen; each report an officer decides is fake is a strike (3 in 30 days: the citizen's reports go to review; 5: reporting is paused). Copy-pasting one hold or reject reason onto many complaints is refused.
- **Admin audit** (`GET /admin/audit`, panel on the admin page): per officer, fixes with a site photo, confirmed by the citizen, reopened, closed by timeout, holds and rejections, plus the latest resolutions to check.
- **Send to crew.** Free `mailto:` and `sms:` links in the complaint brief with a plain-text work order (no reporter names or phone numbers). No email or SMS service is used, so no API key is needed.
- **Tests:** 155 backend tests (22 new). Area pictures for 26 more areas come from Wikimedia Commons, credits in `public/areas/CREDITS.md`.

---
