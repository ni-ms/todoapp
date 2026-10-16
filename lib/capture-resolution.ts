import { Temporal } from "temporal-polyfill";
import rules from "./capture-rules.json";
import type { Draft } from "./ai-contract";
export interface CaptureContext {
    today: string;
    timeZone: string;
    calendarContext?: {
        start: string;
        end: string;
        allDay: boolean;
    }[];
}
const regex = (p: string) => new RegExp(p, "i");
const matches = (s: string, p: string) => [...s.matchAll(new RegExp(p, "gi"))];
const clock = (m: RegExpMatchArray | null) => {
    if (!m)
        return null;
    const hour = Number(m[1]), minute = Number(m[2] ?? 0), meridiem = m[3]?.toLowerCase();
    if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12)))
        return null;
    return { minutes: (meridiem ? hour % 12 + (meridiem === "pm" ? 12 : 0) : hour) * 60 + minute, ambiguous: !meridiem && hour >= 1 && hour <= 12 };
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** Resolve a bounded set of explicit phrases, never model guesses. More complex
 * requests retain model fields and review questions; this is not a general NLP parser. */
export function resolveCapture(drafts: Draft[], request: string, context: CaptureContext): Draft[] {
    const result = structuredClone(drafts), words = rules.numbers as Record<string, number>;
    const durations = matches(request, rules.duration).filter((m)=>!regex(rules.compoundNumberPrefix).test(request.slice(0,m.index!))).map((m) => {
        const n = words[m[1].toLowerCase()] ?? Number(m[1]);
        const minutes = n * (/^h/i.test(m[2]) ? 60 : 1), suffix = request.slice(m.index! + m[0].length), prefix = request.slice(0, m.index);
        return { minutes, session: regex(rules.sessionSuffix).test(suffix), remaining: regex(rules.remainingSuffix).test(suffix) || regex(rules.remainingPrefix).test(prefix) };
    }).filter((v) => Number.isInteger(v.minutes) && v.minutes >= 0 && v.minutes <= 1440);
    const totals = durations.filter((v) => !v.session && !v.remaining);
    for (const d of result) {
        const estimated = new Set(d.estimatedFields);
        if (!regex(rules.priority).test(request)) {
            d.priority = "medium";
            estimated.add("priority");
        }
        if (totals.some((v) => v.minutes === d.estimateMinutes))
            estimated.delete("estimateMinutes");
        else if (!regex(rules.durationUnit).test(request))
            estimated.add("estimateMinutes");
        d.estimatedFields = [...estimated];
    }
    // Model output is a proposal, not evidence that the user asked for prerequisites.
    // Dates and class references alone do not express task-to-task ordering.
    const ordering = request.replace(new RegExp(rules.deadlineDay, "gi"), "")
        .replace(new RegExp(rules.afterClass, "gi"), "")
        .replace(new RegExp(`\\b(?:before|after|until)\\s+${rules.clock}`, "gi"), "");
    if (!regex(rules.dependencyCue).test(ordering))
        for (const d of result) d.scheduling.dependencies = [];
    // Global phrases cannot safely be assigned to individual tasks in a batch.
    if (result.length === 2 && matches(ordering, "\\bbefore\\b").length === 1 && !regex(rules.deadlineDay).test(request) && !/\b(?:after|unless|if)\b/i.test(request)) {
        result[0].scheduling.dependencies = [];
        result[1].scheduling.dependencies = ["draft:0"];
    }
    // Reject remaining self-links and cycles after explicit phrase repair, before saving.
    const visiting = new Set<number>(), visited = new Set<number>();
    const visit = (index: number) => {
        if (visiting.has(index)) throw new Error("Task prerequisites form a loop. Review the task order.");
        if (visited.has(index)) return;
        visiting.add(index);
        for (const id of result[index].scheduling.dependencies) visit(Number(id.slice(6)));
        visiting.delete(index);
        visited.add(index);
    };
    result.forEach((_, index) => visit(index));
    if (result.length !== 1)
        return result;
    const d = result[0], s = d.scheduling;
    if (totals.length === 1 || (totals.length > 1 && regex(rules.correction).test(request))) {
        d.estimateMinutes = totals.at(-1)!.minutes;
        d.estimatedFields = d.estimatedFields.filter((f) => f !== "estimateMinutes");
    }
    if (totals.length > 1 && regex(rules.correction).test(request)) {
        d.title=d.title.replace(new RegExp(rules.duration,"gi"),(text,number:string,unit:string)=>{
            const value=(words[number.toLowerCase()] ?? Number(number))*(/^h/i.test(unit)?60:1);
            return value!==d.estimateMinutes && totals.some((v)=>v.minutes===value) ? `${d.estimateMinutes} minutes` : text;
        });
    }
    const remaining = durations.filter((v) => v.remaining).at(-1);
    if (remaining)
        s.remainingMinutes = remaining.minutes;
    const session = durations.filter((v) => v.session).at(-1);
    if (session && !/\bbreaks?\b/i.test(request)) {
        s.minimumSessionMinutes = session.minutes;
        s.preferredSessionMinutes = session.minutes;
    }
    if (regex(rules.split).test(request))
        s.splittable = true;
    if (regex(rules.singleSitting).test(request)) {
        s.splittable = false;
        if (!session) {
            s.minimumSessionMinutes = 5;
            s.preferredSessionMinutes = 90;
        }
    }
    const questions: string[] = [];
    const recurring = regex(rules.recurrence).test(request);
    if (recurring)
        questions.push(rules.questions.recurrence);
    const today = Temporal.PlainDate.from(context.today);
    const dateFor = (word: string) => {
        word = word.toLowerCase();
        if (word === "today")
            return today;
        if (word === "tomorrow")
            return today.add({ days: 1 });
        const weekday = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].indexOf(word);
        return weekday >= 0 ? today.add({ days: (weekday + 1 - today.dayOfWeek + 7) % 7 }) : Temporal.PlainDate.from(word);
    };
    const dayMatches = matches(request, rules.relativeDay), isoMatches = matches(request, rules.isoDate);
    const days = [...new Set([...dayMatches.map((m) => m[1]), ...isoMatches.map((m) => m[0])].map((word) => dateFor(word).toString()))];
    const deadline = request.match(regex(rules.deadlineDay));
    // Do not guess which date applies in a multi-date or 'next weekday' request.
    const simpleDay = days.length === 1 && !/\bnext\s/i.test(request) && !recurring;
    const matchedZone = request.match(regex(rules.zone))?.[0];
    const requestedZone = matchedZone?.toUpperCase() === "UTC" ? "UTC" : matchedZone ?? context.timeZone;
    const instant = (date: string, minutes: number) => Temporal.PlainDate.from(date).toPlainDateTime({ hour: Math.floor(minutes / 60), minute: minutes % 60 }).toZonedDateTime(requestedZone, { disambiguation: "reject" }).toInstant().toString();
    const at = clock(request.match(regex(`\\bat\\s+${rules.clock}`)));
    const cutoff = clock(request.match(regex(`\\bnever\\s+after\\s+${rules.clock}`)));
    const lower = clock(request.match(regex(`\\bonly\\s+after\\s+${rules.clock}`)));
    const conflict = cutoff && lower && !cutoff.ambiguous && !lower.ambiguous && lower.minutes >= cutoff.minutes;
    if (conflict) {
        questions.push(rules.questions.conflict);
        s.allowedWindows = [];
        if (!regex(rules.preferenceCue).test(request)) s.preferredWindows = [];
        s.earliestStart = null;
    }
    else if (cutoff && !cutoff.ambiguous)
        s.allowedWindows = [{ days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: hhmm(cutoff.minutes) }];
    if (/\bprefer\s+evenings?\b/i.test(request))
        s.preferredWindows = [{ days: [1, 2, 3, 4, 5, 6, 7], start: "18:00", end: hhmm(cutoff && !cutoff.ambiguous ? Math.min(1260, cutoff.minutes) : 1260) }];
    const range = request.match(regex(`\\bfrom\\s+${rules.clock}\\s+(?:to|until|–|-)\\s+${rules.clock}`));
    const rangeStart = range ? clock(range) : null, rangeEnd = range ? clock([range[0], range[4], range[5], range[6]] as RegExpMatchArray) : null;
    if (simpleDay) {
        s.timeZone = requestedZone;
        if (deadline) {
            d.dueDate = dateFor(deadline[1]).toString();
            s.workDate = null;
            if (!at)
                s.deadlineAt = null;
            else if (!at.ambiguous)
                s.deadlineAt = instant(d.dueDate, at.minutes);
        }
        else if (!regex(rules.deadlineCue).test(request) && !regex(rules.workDateExclusion).test(request.slice(0, Math.min(...[...dayMatches, ...isoMatches].map((m) => m.index!))))) {
            d.dueDate = null;
            s.deadlineAt = null;
            s.workDate = days[0];
        }
        if (rangeStart && rangeEnd && !rangeStart.ambiguous && !rangeEnd.ambiguous) {
            s.fixedStart = instant(days[0], rangeStart.minutes);
            s.fixedEnd = instant(days[0], rangeEnd.minutes);
            s.workDate = null;
            s.splittable = false;
            if (!totals.length && s.fixedStart && s.fixedEnd) {
                const elapsed=(Date.parse(s.fixedEnd)-Date.parse(s.fixedStart))/60000;
                if (Number.isInteger(elapsed) && elapsed>=5 && elapsed<=1440) {d.estimateMinutes=elapsed;d.estimatedFields=d.estimatedFields.filter((f)=>f!=="estimateMinutes");}
            }
            if (s.earliestStart && Date.parse(s.earliestStart) === Date.parse(s.fixedStart))
                s.earliestStart = null;
        }
    }
    if (at?.ambiguous) {
        questions.push(rules.questions.ambiguousTime);
        s.fixedStart = null;
        s.fixedEnd = null;
        if (deadline)
            s.deadlineAt = null;
    }
    if (regex(rules.afterClass).test(request) && !regex(rules.classEnd).test(request)) {
        const events = (context.calendarContext ?? []).filter((e) => !e.allDay && (!simpleDay || Temporal.Instant.from(e.end).toZonedDateTimeISO(context.timeZone).toPlainDate().toString() === days[0]));
        if (events.length === 1) {
            s.earliestStart = events[0].end;
            s.unresolved = s.unresolved.filter((q) => !/\bclass\b/i.test(q));
        }
        else {
            questions.push(rules.questions.class);
            s.earliestStart = null;
        }
    }
    if (questions.length)
        s.unresolved = [...new Set([...questions, ...s.unresolved])];
    return result;
}
