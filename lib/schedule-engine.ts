import { Temporal } from "temporal-polyfill";
import type { EventInput, Task, Workspace } from "./domain";
import { defaultScheduling, validateScheduling, type StudyWindow } from "./task-scheduling";
type Interval = [
    number,
    number
];
const minute = 60000;
// Subtract only the allocated block, retaining earlier free time for other tasks.
function subtract(gaps: Interval[], a: number, b: number) {
    for (let i = gaps.length - 1; i >= 0; i--) {
        const [x, y] = gaps[i];
        if (a < y && b > x)
            gaps.splice(i, 1, ...([[x, Math.min(a, y)], [Math.max(b, x), y]] as Interval[]).filter(([s, e]) => s < e));
    }
}
function windows(gaps: Interval[], list: StudyWindow[], zone: string): Interval[] {
    if (!list.length)
        return gaps.map((g) => [...g]);
    const result: Interval[] = [];
    for (const [a, b] of gaps) {
        let date = Temporal.Instant.fromEpochMilliseconds(a).toZonedDateTimeISO(zone).toPlainDate();
        const last = Temporal.Instant.fromEpochMilliseconds(b).toZonedDateTimeISO(zone).toPlainDate();
        while (Temporal.PlainDate.compare(date, last) <= 0) {
            for (const w of list.filter((w) => w.days.includes(date.dayOfWeek))) {
                try {
                    const x = date.toPlainDateTime(Temporal.PlainTime.from(w.start)).toZonedDateTime(zone, { disambiguation: "reject" }).epochMilliseconds;
                    const y = date.toPlainDateTime(Temporal.PlainTime.from(w.end)).toZonedDateTime(zone, { disambiguation: "reject" }).epochMilliseconds;
                    if (Math.max(a, x) < Math.min(b, y))
                        result.push([Math.max(a, x), Math.min(b, y)]);
                }
                catch { /* Ambiguous/nonexistent local preference boundaries are skipped. */ }
            }
            date = date.add({ days: 1 });
        }
    }
    const merged: Interval[] = [];
    for (const [a, b] of result.sort(([a], [b]) => a - b)) {
        const last = merged.at(-1);
        if (last && a <= last[1])
            last[1] = Math.max(last[1], b);
        else
            merged.push([a, b]);
    }
    return merged;
}
export function scheduleTasks(w: Workspace, gaps: Interval[], zone: string, now: number, breakMinutes: number) {
    const events: EventInput[] = [], unscheduled: {
        title: string;
        minutes: number;
        reason: string;
    }[] = [];
    const active = w.tasks.filter((t) => !t.deletedAt && t.status !== "done");
    for (const t of active)
        if (t.scheduling)
            validateScheduling(t.scheduling, t.estimateMinutes);
    const schedule = (t: Task) => t.scheduling ?? defaultScheduling(zone);
    const workBounds = (t: Task): Interval => {
        const s = schedule(t);
        if (!s.workDate)
            return [-Infinity, Infinity];
        const d = Temporal.PlainDate.from(s.workDate);
        return [d.toPlainDateTime({ hour: 0 }).toZonedDateTime(s.timeZone, { disambiguation: "earlier" }).epochMilliseconds, d.add({ days: 1 }).toPlainDateTime({ hour: 0 }).toZonedDateTime(s.timeZone, { disambiguation: "later" }).epochMilliseconds];
    };
    const deadline = (t: Task) => {
        const s = schedule(t);
        const dateEnd = t.dueDate ? Temporal.PlainDate.from(t.dueDate).add({ days: 1 }).toPlainDateTime({ hour: 0 }).toZonedDateTime(s.timeZone, { disambiguation: "later" }).epochMilliseconds : Infinity;
        return Math.min(dateEnd, s.deadlineAt ? Date.parse(s.deadlineAt) : Infinity, workBounds(t)[1]);
    };
    const priority = { high: 0, medium: 1, low: 2 };
    active.sort((a, b) => deadline(a) - deadline(b) || priority[a.priority] - priority[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const state = new Map<string, "visiting" | "done">(), completion = new Map<string, number>();
    const reservations = new Map<string, Interval>();
    // Reserve exact requested appointments before flexible work consumes their space.
    for (const t of active.filter((t) => schedule(t).fixedStart).sort((a, b) => Date.parse(schedule(a).fixedStart!) - Date.parse(schedule(b).fixedStart!) || a.id.localeCompare(b.id))) {
        const s = schedule(t), a = Date.parse(s.fixedStart!), b = Date.parse(s.fixedEnd!);
        if (s.remainingMinutes === 0)
            continue;
        if (!s.unresolved.length && a >= Math.max(now, workBounds(t)[0]) && b <= deadline(t) && a >= (s.earliestStart ? Date.parse(s.earliestStart) : now) && windows(gaps, s.allowedWindows, s.timeZone).some(([x, y]) => x <= a && y >= b)) {
            reservations.set(t.id, [a, b]);
            subtract(gaps, a - breakMinutes * minute, b + breakMinutes * minute);
        }
    }
    const visit = (t: Task): boolean => {
        if (state.get(t.id) === "done")
            return completion.has(t.id);
        if (state.get(t.id) === "visiting")
            return false;
        state.set(t.id, "visiting");
        const s = schedule(t);
        validateScheduling(s, t.estimateMinutes);
        let earliest = Math.max(now, workBounds(t)[0], s.earliestStart ? Date.parse(s.earliestStart) : now), reason = "";
        if (s.unresolved.length)
            reason = "Resolve the questions in this task's scheduling details before planning.";
        for (const dep of s.dependencies) {
            const prerequisite = w.tasks.find((p) => p.id === dep && !p.deletedAt);
            if (!prerequisite || (prerequisite.status !== "done" && !visit(prerequisite)))
                reason = "A prerequisite is missing, unfinished, or part of a dependency cycle.";
            else
                earliest = Math.max(earliest, completion.get(dep) ?? now);
        }
        const limit = deadline(t), effort = s.remainingMinutes ?? t.estimateMinutes;
        const existing = w.events.filter((e) => !e.deletedAt && !e.allDay && e.taskId === t.id).map((e) => [Date.parse(e.start), Date.parse(e.end)] as Interval).filter(([a, b]) => a >= earliest && b <= limit && (!s.fixedStart || (a === Date.parse(s.fixedStart) && b === Date.parse(s.fixedEnd!))) && windows([[a, b]], s.allowedWindows, s.timeZone).some(([x, y]) => x <= a && y >= b));
        // Union reservations; overlapping manual sessions must not double-count effort.
        existing.sort(([a], [b]) => a - b);
        let reserved = 0, cursor = -Infinity, finish = earliest;
        for (const [a, b] of existing) {
            reserved += Math.max(0, b - Math.max(a, cursor)) / minute;
            cursor = Math.max(cursor, b);
            finish = Math.max(finish, b);
        }
        let remaining = Math.max(0, effort - Math.floor(reserved));
        const add = (a: number, b: number) => { events.push({ title: t.title, description: "Planned from your task's scheduling details. Move or resize to adjust.", start: new Date(a).toISOString(), end: new Date(b).toISOString(), allDay: false, timeZone: s.timeZone, tagIds: t.tagIds.filter((id) => w.tags.some((tag) => tag.id === id && !tag.deletedAt)), taskId: t.id }); remaining = Math.max(0, remaining - (b - a) / minute); finish = Math.max(finish, b); };
        if (!reason && remaining > 0 && s.fixedStart) {
            const pair = reservations.get(t.id);
            if (!pair || pair[0] < earliest || (pair[1] - pair[0]) / minute > remaining || (!s.splittable && (pair[1] - pair[0]) / minute !== remaining) || (pair[1] - pair[0]) / minute < s.minimumSessionMinutes || events.length >= 100)
                reason = "The fixed block conflicts with commitments, availability, prerequisites, or remaining effort.";
            else {
                add(...pair);
                if (remaining)
                    reason = "The fixed block covers only part of the remaining effort. Adjust it or remove the fixed time.";
            }
        }
        else if (!reason && remaining > 0) {
            while (remaining > 0 && events.length < 100) {
                const hard = windows(gaps.map(([a, b]) => [Math.max(a, earliest), Math.min(b, limit)] as Interval).filter(([a, b]) => a < b), s.allowedWindows, s.timeZone);
                const preferred = s.preferredWindows.length ? windows(hard, s.preferredWindows, s.timeZone) : [];
                const candidates = [...preferred, ...hard];
                const length = (a: number, b: number) => { let n = Math.min(remaining, s.splittable ? s.preferredSessionMinutes : remaining, Math.floor((b - a) / minute)); if (s.splittable && remaining > n && remaining - n < s.minimumSessionMinutes)
                    n = remaining - s.minimumSessionMinutes; return n; };
                const candidate = candidates.find(([a, b]) => {
                    const n = length(a, b);
                    return n >= s.minimumSessionMinutes && (s.splittable || n === remaining) && (remaining - n === 0 || remaining - n >= s.minimumSessionMinutes);
                });
                if (!candidate)
                    break;
                const [a, b] = candidate, n = length(a, b), end = a + n * minute;
                add(a, end);
                subtract(gaps, a - breakMinutes * minute, end + breakMinutes * minute);
            }
        }
        if (reason || remaining > 0)
            unscheduled.push({ title: t.title, minutes: remaining, reason: reason || (limit <= now ? "Deadline has passed." : "Not enough free time within the deadline, start, and session limits. Try more availability or smaller sessions.") });
        else
            completion.set(t.id, finish);
        state.set(t.id, "done");
        return completion.has(t.id);
    };
    for (const t of active)
        visit(t);
    return { events, unscheduled };
}
