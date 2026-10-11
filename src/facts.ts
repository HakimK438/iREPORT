/* Small decision helpers for the control room. The urgency itself (response category, due date, overdue) is computed by the
   server from risk = impact x likelihood; nothing about urgency is computed or guessed here. */
import { isOpen, type ResponseCat } from "./store";

/** The one primary action on a complaint, by status (and whether someone is assigned). */
export type NextAction = "acknowledge" | "assign" | "schedule" | "start" | "resume" | "resolve" | null;

export function nextAction(r: { status: string; assignee: unknown }): NextAction {
  switch (r.status) {
    case "Reported": return "acknowledge";
    case "Acknowledged": return "start";
    case "Reopened": return "start";
    case "Scheduled": return "start";
    case "In Progress": return "resolve";
    case "On Hold": return "resume";
    default: return null; // Resolved: waiting for the citizen; Closed / Rejected / Duplicate / Transferred: nothing left to do
  }
}

/** Colour of a card: red for Emergency or overdue, amber for Urgent, green otherwise. Colour is never the only signal (the chip has the word). */
export function tone(r: { status: string; response: ResponseCat; overdue: boolean }): "red" | "amber" | "green" {
  if (!isOpen(r.status)) return "green";
  if (r.overdue || r.response === "Emergency") return "red";
  if (r.response === "Urgent") return "amber";
  return "green";
}

export const LOCALE = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" } as const;

/** "12 Oct" in the officer's language. */
export const shortDate = (iso: string, lang: keyof typeof LOCALE): string => new Date(iso).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short" });

/** Google Maps directions to the complaint (opened by the officer's own click; the app itself calls no map service). */
export const navigateUrl = (lat: number, lng: number): string => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;

/** URL-safe name of a locality, the file name of its photo in public/areas/. */
export const areaSlug = (area: string): string => area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
