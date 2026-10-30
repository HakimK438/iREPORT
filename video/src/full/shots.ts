import citizen from "../../public/screens/citizen.json";
import officer from "../../public/screens/officer.json";
import confirm from "../../public/screens/confirm.json";
import extras from "../../public/screens/extras.json";

/*
 * The product demo, shot by shot. Screenshots are real captures of the running site (capture/*.mjs),
 * 1600x900 CSS px each. Coordinates below are in those CSS px; frames are local to the shot.
 */

type Rect = { x: number; y: number; w: number; h: number };
const ALL = [...citizen.steps, ...officer.steps, ...confirm.steps, ...extras.steps] as { id: string; targets: Record<string, Rect> }[];
export const rect = (shot: string, name: string): Rect => {
  const r = ALL.find((s) => s.id === shot)?.targets[name];
  if (!r) throw new Error(`no target ${name} in ${shot}`);
  return r;
};
const mid = (shot: string, name: string): [number, number] => {
  const r = rect(shot, name);
  return [r.x + r.w / 2, r.y + r.h / 2];
};
/** A point a little inside a wide button, where a person would actually click. */
const onButton = (shot: string, name: string, dx = 0): [number, number] => {
  const r = rect(shot, name);
  return [r.x + Math.min(r.w / 2, 120) + dx, r.y + r.h / 2];
};

export type Chapter = { n: string; title: string };
export const CHAPTERS: Record<string, Chapter> = {
  citizen: { n: "01", title: "Citizen reports" },
  officer: { n: "02", title: "Ward office acts" },
  confirm: { n: "03", title: "Citizen confirms" },
  overview: { n: "04", title: "City overview" },
};

export type Shot = {
  file: string;
  dur: number;
  chapter: keyof typeof CHAPTERS;
  caption: string;
  /** [frame, scale, focusX, focusY] */
  cam?: [number, number, number, number][];
  /** [frame, x, y] cursor keyframes; the cursor starts where the previous shot left it */
  moves?: [number, number, number][];
  clicks?: number[];
  /** Target rectangles to outline while the cursor works on them: [fromFrame, toFrame, rect] */
  marks?: [number, number, Rect][];
  chime?: number;
};

const P = (shot: string, name: string, dx = 0) => onButton(shot, name, dx);

export const SHOTS: Shot[] = [
  // 01 · Citizen reports
  {
    file: "c00-home", dur: 70, chapter: "citizen", caption: "Report a civic problem in Mumbai in under a minute",
    cam: [[0, 1, 800, 450], [70, 1.18, 560, 470]],
    moves: [[0, 1180, 760], [44, ...P("c00-home", "start")]], clicks: [50], marks: [[36, 62, rect("c00-home", "start")]],
  },
  {
    file: "c02-category", dur: 54, chapter: "citizen", caption: "Pick the problem",
    cam: [[0, 1.12, 800, 520], [54, 1.3, 700, 500]],
    moves: [[0, 900, 760], [26, ...mid("c02-category", "pothole")]], clicks: [32], marks: [[20, 50, rect("c02-category", "pothole")]],
  },
  {
    file: "c03-category-picked", dur: 30, chapter: "citizen", caption: "Pick the problem",
    cam: [[0, 1.12, 800, 560]],
    moves: [[0, ...mid("c02-category", "pothole")], [16, ...P("c03-category-picked", "next")]], clicks: [22],
  },
  {
    file: "c05-questions-done", dur: 50, chapter: "citizen", caption: "Answer a few taps, or describe it by voice",
    cam: [[0, 1.25, 800, 520], [50, 1.35, 800, 600]],
    moves: [[0, 800, 600], [30, ...P("c05-questions-done", "next")]], clicks: [38], marks: [[0, 30, rect("c05-questions-done", "description")]],
  },
  {
    file: "c07-photo-added", dur: 36, chapter: "citizen", caption: "Add a photo of the problem",
    cam: [[0, 1.45, 640, 400], [36, 1.55, 600, 430]],
    moves: [[0, 800, 520], [20, 650, 470]], marks: [[4, 34, rect("c07-photo-added", "preview")]],
  },
  {
    file: "c08-gps", dur: 30, chapter: "citizen", caption: "Pin the exact spot with GPS",
    cam: [[0, 1.3, 700, 470]],
    moves: [[0, 650, 470], [14, ...P("c08-gps", "gps")]], clicks: [20], marks: [[8, 28, rect("c08-gps", "gps")]],
  },
  {
    file: "c09-location", dur: 42, chapter: "citizen", caption: "Pin the exact spot with GPS",
    cam: [[0, 1.2, 800, 450], [42, 1.6, 790, 430]],
    moves: [[0, 1000, 560], [30, 1080, 600]],
  },
  {
    file: "c10-location-next", dur: 27, chapter: "citizen", caption: "Pin the exact spot with GPS",
    cam: [[0, 1.12, 800, 560]],
    moves: [[0, 1080, 600], [12, ...P("c10-location-next", "next")]], clicks: [18],
  },
  {
    file: "c11-review", dur: 30, chapter: "citizen", caption: "Review: ward, department and severity filled in",
    cam: [[0, 1.2, 800, 330], [30, 1.35, 800, 640]],
    moves: [[0, 1180, 700]],
  },
  {
    file: "c12-ai", dur: 36, chapter: "citizen", caption: "AI photo check, labelled as a suggestion, never final",
    cam: [[0, 1.3, 800, 450], [36, 1.45, 800, 440]],
    moves: [[0, 1180, 700], [30, 1150, 690]], marks: [[4, 34, rect("c12-ai", "ai")]],
  },
  {
    file: "c13-submit", dur: 33, chapter: "citizen", caption: "Confirm and submit",
    cam: [[0, 1.25, 800, 640]],
    moves: [[0, 1100, 680], [9, ...mid("c13-submit", "consent")], [22, ...P("c13-submit", "submit")]], clicks: [12, 27],
    marks: [[18, 33, rect("c13-submit", "submit")]],
  },
  {
    file: "c14-success", dur: 42, chapter: "citizen", caption: "Submitted: IR-20261029-00811, routed to Andheri West ward",
    cam: [[0, 1.2, 800, 450], [42, 1.6, 800, 480]],
    moves: [[0, 800, 760], [30, 1060, 720]], chime: 4, marks: [[10, 42, rect("c14-success", "id")]],
  },

  // 02 · Ward office acts
  {
    file: "o00-control-room-top", dur: 39, chapter: "officer", caption: "The Andheri West ward office opens its control room",
    cam: [[0, 1, 800, 450], [39, 1.12, 700, 330]],
    moves: [[0, 1280, 720]],
  },
  {
    file: "o02-complaint-in-list", dur: 54, chapter: "officer", caption: "New complaint on top: HIGH RISK, scored by fixed rules",
    cam: [[0, 1.05, 800, 420], [30, 1.55, 800, 470], [54, 1.6, 760, 470]],
    moves: [[0, 1280, 720], [34, ...P("o02-complaint-in-list", "card", 40)]], clicks: [40], marks: [[16, 52, rect("o02-complaint-in-list", "card")]],
  },
  {
    file: "o03-brief", dur: 42, chapter: "officer", caption: "One clear next step: Acknowledge",
    cam: [[0, 1.3, 600, 330], [42, 1.4, 560, 360]],
    moves: [[0, 700, 380], [18, ...mid("o03-brief", "action")]], clicks: [24], marks: [[12, 34, rect("o03-brief", "action")]],
  },
  {
    file: "o04-acknowledged", dur: 36, chapter: "officer", caption: "Then: Start work",
    cam: [[0, 1.35, 600, 340]],
    moves: [[0, ...mid("o03-brief", "action")], [14, ...mid("o04-acknowledged", "action")]], clicks: [20], marks: [[8, 30, rect("o04-acknowledged", "action")]],
  },
  {
    file: "o05-in-progress", dur: 36, chapter: "officer", caption: "Then: Mark resolved",
    cam: [[0, 1.35, 600, 340]],
    moves: [[0, ...mid("o04-acknowledged", "action")], [14, ...mid("o05-in-progress", "action")]], clicks: [20], marks: [[8, 30, rect("o05-in-progress", "action")]],
  },
  {
    file: "o06-resolve-panel", dur: 27, chapter: "officer", caption: "A fix needs a photo taken at the site",
    cam: [[0, 1.3, 760, 380]],
    moves: [[0, ...mid("o05-in-progress", "action")], [12, ...P("o06-resolve-panel", "proof", 360)]], clicks: [18], marks: [[6, 27, rect("o06-resolve-panel", "proof")]],
  },
  {
    file: "o07-proof-ready", dur: 36, chapter: "officer", caption: "Photo position checked: 0 m from the complaint",
    cam: [[0, 1.6, 480, 250], [18, 1.6, 480, 260], [36, 1.35, 560, 380]],
    moves: [[0, 700, 300], [24, ...mid("o07-proof-ready", "confirm")]], clicks: [30], marks: [[20, 36, rect("o07-proof-ready", "confirm")]],
  },

  // 03 · Citizen confirms
  {
    file: "c20-my-reports-resolved", dur: 75, chapter: "confirm", caption: "The citizen tracks every step, then confirms the fix",
    cam: [[0, 1.3, 700, 160], [34, 1.3, 700, 180], [60, 1.35, 560, 380]],
    moves: [[0, 1200, 700], [50, ...mid("c20-my-reports-resolved", "confirm")]], clicks: [56], marks: [[42, 70, rect("c20-my-reports-resolved", "confirm")]],
  },
  {
    file: "c21-confirmed", dur: 45, chapter: "confirm", caption: "Closed, confirmed by the person who reported it",
    cam: [[0, 1.3, 760, 190], [45, 1.42, 760, 200]],
    moves: [[0, ...mid("c20-my-reports-resolved", "confirm")], [40, 520, 520]], chime: 6,
  },

  // 04 · City overview
  {
    file: "a01-admin", dur: 42, chapter: "overview", caption: "Admin view: every open problem in Mumbai, with clusters",
    cam: [[0, 1.05, 800, 450], [42, 1.3, 760, 560]],
    moves: [[0, 1300, 800]],
  },
  {
    file: "o09-analysis", dur: 36, chapter: "overview", caption: "Ward analysis in plain words, with a printable report",
    cam: [[0, 1.15, 600, 520], [36, 1.25, 600, 540]],
    moves: [[0, 1300, 800]],
  },
];

/** Start frame of every shot, relative to the start of the demo. */
export const STARTS = SHOTS.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + SHOTS[i - 1].dur], []);
export const DEMO_FRAMES = SHOTS.reduce((t, s) => t + s.dur, 0);
