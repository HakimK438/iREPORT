# Purpose and impact

This is the plain-language description of the project. For the feature list and setup see [README.md](PURPOSE_AND_IMPACT.md); for every rule and data flow see [PROJECT_WORKFLOW.md](WORKFLOW.md).

### 1. The problem

In a large city, small civic problems (a pothole, a dead streetlight, a leaking pipe, a bare wire) are reported by phone calls, letters, social media posts and walk-ins. Ward offices then face four difficulties:

1. **Duplicates and noise.** The same problem arrives many times, from many people, in different words. One person can report it again and again.
2. **No shared sense of urgency.** A bare wire near a school and a litter pile look the same in a list sorted by date.
3. **Unclear ownership.** It is not obvious who is handling a complaint, whether it is late, or whether the fix was real.
4. **No view of the whole.** Officers cannot easily see where problems pile up, which repairs keep failing, or which ward is falling behind.

Citizens face the mirror image: they report, hear nothing, and cannot tell whether anything happened.

### 2. What iREPORT does about it

iREPORT is a reporting app for citizens and a control room for officers, joined by one shared record of each complaint.

| Problem | What iREPORT does |
|---|---|
| Duplicates | One report per person per spot. A second report from the same person within 50 m is refused, and they are offered to add a photo instead. Other people near an existing complaint are offered a one-tap **confirm**, so the count of affected people rises without a second complaint. |
| Unclear urgency | Every complaint gets one of four hazard categories (CRITICAL, HIGH RISK, MODERATE RISK, ROUTINE) from a documented risk method, with a symbol, a one-line reason and a recommended action. Each reason names its source: checked on map, citizen says, complaint records, calendar or category. |
| Unclear ownership and lateness | Each complaint has a status, an assigned officer, a due date, and an "overdue" flag that is computed in one place. Every change is recorded with who did it and why. |
| Fix not verified | When an officer marks a complaint resolved, the original reporter confirms it (it closes) or reopens it with a reason. The original due date keeps running after a reopen. Unanswered complaints close automatically after 72 hours. |
| No view of the whole | The Analysis tab shows backlog over 12 weeks, area-wise open and overdue work, the hazard mix, on-time performance by department and ward, repeat spots, and a map with Critical, Overdue and Unassigned layers. It can print a report and export a CSV. |
| Opaque AI | Two small models suggest a category from a photo and a description. The suggestion is labelled "AI suggestion, not verified", never overrides the citizen, and never decides urgency. |

### 3. Who uses it

**Citizens** report a problem in about two minutes: pick the problem, answer a few questions by tapping or speaking, add photos, pin the spot, review, send. They then follow a six-step timeline in My Reports and answer the "is it fixed?" question. The interface is in English, Hindi and Marathi.

**Officers** (ward officers, junior engineers, department heads) open the control room. The top of the list shows the most serious complaints. Each complaint opens as a work-order-style brief with one primary action. They can act on many complaints at once, print an A4 work order for the crew, and study trends in the Analysis tab.

**Administrators** approve or revoke officer accounts and see the whole city's workload.

### 4. How a complaint is judged

1. **Impact** (1 to 4) from what the problem is: an electrical hazard is a risk to life (4); a pothole, drainage or water problem can injure people or damage vehicles (3); garbage and a streetlight outage are health or safety nuisances (2); anything else is an inconvenience (1). A reporter who calls it dangerous can raise this by one level, never lower it.
2. **Likelihood** (1 to 4) starts at 1 and gains a point for each of: on a main road; within 100 m of a school or hospital; 3 or more different citizens reported or confirmed it; a monsoon month for road and water problems; a night-time hazard or an open streetlight complaint nearby.
3. **Risk = impact x likelihood** (1 to 16). 12 and above is CRITICAL, 8 to 11 HIGH RISK, 4 to 7 MODERATE RISK, below 4 ROUTINE.
4. The risk also sets a due date (24 hours, 3 days, 14 days or 30 days from the report). The date only ever moves earlier.

This is the risk-matrix approach used in road maintenance practice. Every number sits in one configuration file, and the same formula is tested in Python and SQL. A raw 0 to 100 score exists only to sort the list; officers are shown the category.

### 5. The impact it is designed to have

These are the changes the design aims for, and the figures the app itself computes so that anyone can check them. **No field results exist yet**, because the system has not been deployed to real users.

| Intended change | How it is delivered | How to check it (in the Analysis tab) |
|---|---|---|
| Fewer duplicate complaints for officers to sort | One report per spot, confirm instead of re-reporting, duplicates merged with reporters moved across | Reported by N distinct citizens per complaint; duplicate count in the history |
| The most dangerous problems are seen first | Hazard categories and a sorted list with source-labelled reasons | Critical open count; time to first action by category |
| Fewer late repairs | Due dates, overdue flag, assignee, bulk assign and schedule | Overdue count, closed within due date, backlog trend |
| Fewer repairs that fail | Reopen with a reason, "history at this spot", repeat-spot report | Reopen rate; repeat spots (same problem within 50 m and 90 days after a closure) |
| Better use of crews | "Nearby open work" within 300 m, the area-wise view, printed work orders | Open and overdue by area; clusters on the map |
| Trust from citizens | A visible timeline, messages, a confirm-or-reopen step | Share confirmed versus auto-closed; messages answered |
| Accountability | Every status change stores actor and reason; CSV and printable report | The timeline on each complaint; exported reports |

### 6. Principles the project follows

- **The server decides.** Urgency, "open", overdue and counts are computed by the backend from fixed rules, so every screen agrees.
- **Say where a fact came from.** Map checks, the citizen's claim, complaint records, the calendar and the category table are labelled differently.
- **Never invent confidence.** A percentage is shown only if a model produced it. The AI is an assistant and is marked unverified.
- **Never silently drop data.** Repeat reports are flagged and hidden, not deleted. Failed downloads are reported, not faked.
- **Respect privacy.** Photos are stripped of metadata, phone numbers are not printed, citizens can export or delete their data. Before a public launch, the data handling should be reviewed under India's DPDP Act, 2023.
- **Accessible by default.** Count chips and buttons are keyboard operable, charts have text summaries and data tables, motion respects "reduce motion", and colour is never the only signal (every category also has a symbol and a word).

### 7. What is not finished

- Map checks from OpenStreetMap (schools, hospitals, main roads) are built but not loaded; until then, those facts come from what the citizen ticked and are labelled "citizen says".
- Some officer actions were verified by automated tests but not clicked through by a person in a browser.
- Hindi and Marathi wording needs review by native speakers.
- The image model recognises six classes only and is a demonstration-level model; it needs real Mumbai photos before anyone relies on it.
- Real ward boundaries are not loaded; areas are assigned from the nearest of the seeded area centres.
- Performance was measured on an earlier build and should be re-measured on the real server.

Details of each gap and its reason: [README.md](FEATURES.md#known-gaps) and [REVIEW_AUTHORITY_V2.md](REVIEW_AUTHORITY_V2.md).

---

