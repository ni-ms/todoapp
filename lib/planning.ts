import { scheduleTasks } from "./schedule-engine";
import { Temporal } from "temporal-polyfill";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop, previewTransaction } from "./storage";
import { validateEvent, type EventInput, type Workspace } from "./domain";

export interface PlanOptions {
  startDate: string;
  timeZone: string;
  startHour: number;
  endHour: number;
  weekends: boolean;
  breakMinutes: number;
}
export interface Proposal {
  id: string;
  events: EventInput[];
  unscheduled: { taskId: string; title: string; minutes: number; reason: string }[];
  fingerprint: string;
}
export const workspaceFingerprint = (w: Workspace) => JSON.stringify(w);
const minute = 60_000;
function boundary(
  date: Temporal.PlainDate,
  hour: number,
  zone: string,
  disambiguation: "reject" | "earlier" | "later" = "reject",
) {
  return date
    .toPlainDateTime({ hour })
    .toZonedDateTime(zone, { disambiguation }).epochMilliseconds;
}
/** Browser counterpart of the native seven-day scheduler. Time and IDs are injected for tests. */
export function plan(
  w: Workspace,
  o: PlanOptions,
  now: number,
  id: string,
): Proposal {
  const first = Temporal.PlainDate.from(o.startDate);
  const today = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(o.timeZone)
    .toPlainDate();
  if (
    first.toString() !== o.startDate ||
    Temporal.PlainDate.compare(first, today) < 0 ||
    Temporal.PlainDate.compare(first, today.add({ days: 31 })) > 0 ||
    !Number.isInteger(o.startHour) ||
    !Number.isInteger(o.endHour) ||
    o.startHour < 0 ||
    o.startHour >= o.endHour ||
    o.endHour > 23 ||
    !Number.isInteger(o.breakMinutes) ||
    o.breakMinutes < 0 ||
    o.breakMinutes > 60
  ) {
    throw new Error(
      "Choose future dates, valid study hours, and breaks of 0–60 minutes.",
    );
  }
  const gaps: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const date = first.add({ days: i });
    if (!o.weekends && date.dayOfWeek > 5) continue;
    let start: number, end: number;
    try {
      start = boundary(date, o.startHour, o.timeZone);
      end = boundary(date, o.endHour, o.timeZone);
    } catch {
      continue;
    } // Skip study windows with ambiguous/nonexistent boundaries.
    start = Math.max(start, Math.ceil(now / (15 * minute)) * 15 * minute);
    if (start >= end) continue;
    const blocked = w.events
      .filter((e) => !e.deletedAt)
      .map((e) =>
        e.allDay
          ? [
              boundary(
                Temporal.PlainDate.from(e.start),
                0,
                o.timeZone,
                "earlier",
              ),
              boundary(Temporal.PlainDate.from(e.end), 0, o.timeZone, "later"),
            ]
          : [Date.parse(e.start), Date.parse(e.end)],
      )
      .filter(([a, b]) => a < end && b + o.breakMinutes * minute > start)
      .sort(([a], [b]) => a - b);
    let cursor = start;
    for (const [a, b] of blocked) {
      if (a - o.breakMinutes * minute > cursor) gaps.push([cursor, Math.min(a - o.breakMinutes * minute, end)]);
      cursor = Math.max(cursor, b + o.breakMinutes * minute);
      if (cursor >= end) break;
    }
    if (cursor < end) gaps.push([cursor, end]);
  }
  const { events, unscheduled } = scheduleTasks(w, gaps, o.timeZone, now, o.breakMinutes);
  return { id, events, unscheduled, fingerprint: workspaceFingerprint(w) };
}
let pending: Proposal | null = null;
export async function previewPlan(options: PlanOptions): Promise<Proposal> {
  if (isDesktop()) return invoke("preview_plan", { options });
  const w = await previewTransaction();
  pending = plan(w, options, Date.now(), crypto.randomUUID());
  return pending;
}
export function applyProposal(w: Workspace, p: Proposal, now: string) {
  if (workspaceFingerprint(w) !== p.fingerprint)
    throw new Error(
      "Your tasks or calendar changed. Preview a new plan before applying it.",
    );
  if (!p.events.length) throw new Error("There are no sessions to add.");
  if (p.events.some((e) => Date.parse(e.start) < Date.parse(now)))
    throw new Error(
      "This plan is out of date. Preview again to avoid scheduling in the past.",
    );
  p.events.forEach(validateEvent);
  const records = p.events.map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));
  w.events.push(...records);
  return records.map((e) => ({ id: e.id, revision: JSON.stringify(e) }));
}
export async function applyPlan(id: string): Promise<Workspace> {
  if (isDesktop()) return invoke("apply_plan", { id });
  const p = pending;
  if (!p || p.id !== id)
    throw new Error("This proposal expired. Preview a new plan.");
  const w = await previewTransaction((w, metadata) => {
    metadata.lastPlan = applyProposal(w, p, new Date().toISOString());
  });
  pending = null;
  return w;
}
export function undoProposal(
  w: Workspace,
  records: { id: string; revision: string }[],
  now: string,
) {
  if (!records.length) throw new Error("There is no plan to undo.");
  if (
    records.some(
      (r) =>
        !w.events.some(
          (e) =>
            e.id === r.id && JSON.stringify(e) === r.revision && !e.deletedAt,
        ),
    )
  )
    throw new Error(
      "A planned session was edited or removed. Undo stopped to preserve your changes; adjust those sessions in Calendar.",
    );
  for (const record of records) {
    const e = w.events.find((e) => e.id === record.id)!;
    e.deletedAt = now;
    e.updatedAt = now;
  }
}
export async function undoPlan(): Promise<Workspace> {
  if (isDesktop()) return invoke("undo_plan");
  return previewTransaction((w, metadata) => {
    undoProposal(w, metadata.lastPlan ?? [], new Date().toISOString());
    metadata.lastPlan = [];
  });
}
export async function planUndoAvailable(): Promise<boolean> {
  if (isDesktop()) return invoke("plan_undo_available");
  let available = false;
  await previewTransaction((w, metadata) => {
    available = Boolean(metadata.lastPlan?.length);
  });
  return available;
}
