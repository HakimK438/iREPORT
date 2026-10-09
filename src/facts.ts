/* Plain decision helpers for the control room: how long a problem has waited, whether it is past its target, and what to do next.
   Everything here is a fixed rule over fields the API already returns; nothing is predicted. */
import type { StrKey } from "./i18n";

/** Target days to first visit by priority level (also explained to the officer in the on-screen glossary). */
export const SLA_DAYS: Record<string, number> = { Critical: 1, High: 3, Medium: 7, Low: 14 };

export const daysSince = (iso: string): number => Math.max(0, (Date.now() - Date.parse(iso)) / 86_400_000);

export interface Wait { days: number; target: number; overdueBy: number; closed: boolean }

export function waitOf(createdAt: string, level: string, status: string): Wait {
  const days = daysSince(createdAt), target = SLA_DAYS[level] ?? 14, closed = status === "Resolved";
  return { days, target, overdueBy: closed ? 0 : Math.max(0, Math.floor(days - target)), closed };
}

/** The one-line recommended next step, as a translation key. */
export function actionKey(level: string, status: string): StrKey {
  if (status === "Resolved") return "s_act_done";
  if (status === "Reported") return level === "Critical" || level === "High" ? (`s_act_${level}` as StrKey) : "s_act_review";
  if (status === "In Progress") return "s_act_progress";
  return `s_act_${level}` as StrKey;
}

/** Red for overdue or critical, amber for high or close to the target, green otherwise. */
export function tone(level: string, w: Wait): "red" | "amber" | "green" {
  if (w.closed) return "green";
  if (w.overdueBy > 0 || level === "Critical") return "red";
  if (level === "High" || w.days >= w.target * 0.7) return "amber";
  return "green";
}
