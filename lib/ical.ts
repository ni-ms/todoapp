import type { Workspace } from "./domain";
import { downloadFile, isDesktop } from "./storage";
import { invoke } from "@tauri-apps/api/core";
export function addDays(value: string, days: number) {
  const d = new Date(value + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function folded(value: string) {
  let length = 0,
    out = "";
  for (const char of value) {
    const bytes = new TextEncoder().encode(char).length;
    if (length + bytes > 75) {
      out += "\r\n ";
      length = 1;
    }
    out += char;
    length += bytes;
  }
  return out + "\r\n";
}
function stamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");
}
export function calendarText(workspace: Workspace): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Daymark//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Daymark",
  ];
  for (const e of workspace.events.filter((e) => !e.deletedAt)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:event-${e.id}@daymark.local`,
      `DTSTAMP:${stamp(e.updatedAt)}`,
      `LAST-MODIFIED:${stamp(e.updatedAt)}`,
    );
    lines.push(
      e.allDay
        ? `DTSTART;VALUE=DATE:${e.start.replaceAll("-", "")}`
        : `DTSTART:${stamp(e.start)}`,
      e.allDay
        ? `DTEND;VALUE=DATE:${e.end.replaceAll("-", "")}`
        : `DTEND:${stamp(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      "END:VEVENT",
    );
  }
  for (const t of workspace.tasks.filter(
    (t) => !t.deletedAt && t.status !== "done" && t.dueDate,
  ))
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@daymark.local`,
      `DTSTAMP:${stamp(t.updatedAt)}`,
      `DTSTART;VALUE=DATE:${t.dueDate!.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${addDays(t.dueDate!, 1).replaceAll("-", "")}`,
      `SUMMARY:${escapeText("Due: " + t.title)}`,
      `DESCRIPTION:${escapeText(t.description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  lines.push("END:VCALENDAR");
  return lines.map(folded).join("");
}
export async function exportCalendar(
  workspace: Workspace,
): Promise<string | undefined> {
  if (isDesktop()) return invoke<string>("export_calendar");
  downloadFile(
    calendarText(workspace),
    "text/calendar;charset=utf-8",
    `daymark-calendar.ics`,
  );
}
