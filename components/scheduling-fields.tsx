"use client";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { defaultScheduling, type StudyWindow, type TaskScheduling } from "@/lib/task-scheduling";
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function SchedulingFields({ value, onChange, dependencies = [] }: {
    value?: TaskScheduling | null;
    onChange: (value: TaskScheduling) => void;
    dependencies?: {
        id: string;
        title: string;
    }[];
}) {
    const s = value ?? defaultScheduling();
    const [error, setError] = useState("");
    const patch = (p: Partial<TaskScheduling>) => onChange({ ...s, ...p });
    const local = (instant: string | null) => instant ? Temporal.Instant.from(instant).toZonedDateTimeISO(s.timeZone).toPlainDateTime().toString({ smallestUnit: "minute" }) : "";
    function timed(key: "deadlineAt" | "earliestStart" | "fixedStart" | "fixedEnd", text: string) {
        try {
            setError("");
            patch({ [key]: text ? Temporal.PlainDateTime.from(text).toZonedDateTime(s.timeZone, { disambiguation: "reject" }).toInstant().toString() : null });
        }
        catch {
            setError("That local time is ambiguous or does not exist because of a clock change. Choose a different time.");
        }
    }
    const windowFields = (key: "allowedWindows" | "preferredWindows", title: string) => <fieldset className="space-y-2 rounded-lg border p-3">
    <legend className="px-1 text-xs font-medium">{title}</legend>
    {!s[key].length && <p className="text-xs text-muted-foreground">{key === "allowedWindows" ? "Use all available study hours." : "Use the earliest available time."}</p>}
    {s[key].map((w, index) => {
            const update = (p: Partial<StudyWindow>) => patch({ [key]: s[key].map((item, i) => i === index ? { ...item, ...p } : item) });
            return <div key={index} className="space-y-2 border-b pb-3 last:border-0">
        <div className="flex flex-wrap gap-2">{days.map((day, i) => <label key={day} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={w.days.includes(i + 1)} onChange={(e) => update({ days: e.target.checked ? [...w.days, i + 1].sort() : w.days.filter((d) => d !== i + 1) })}/>{day}</label>)}</div>
        <div className="flex items-center gap-2"><Input aria-label={`${title} ${index + 1} start`} type="time" value={w.start} onChange={(e) => update({ start: e.target.value })}/><span className="text-xs">to</span><Input aria-label={`${title} ${index + 1} end`} type="time" value={w.end} onChange={(e) => update({ end: e.target.value })}/><Button type="button" size="sm" variant="ghost" onClick={() => patch({ [key]: s[key].filter((_, i) => i !== index) })}>Remove</Button></div>
      </div>;
        })}
    <Button type="button" size="sm" variant="outline" disabled={s[key].length >= 14} onClick={() => patch({ [key]: [...s[key], { days: [1, 2, 3, 4, 5], start: "18:00", end: "21:00" }] })}>Add window</Button>
  </fieldset>;
    return <details className="rounded-lg border p-3">
    <summary className="cursor-pointer text-sm font-medium">Scheduling details{s.unresolved.length ? ` · ${s.unresolved.length} needs clarification` : ""}</summary>
    <div className="mt-3 space-y-4">
      <label className="block space-y-1 text-xs">Time zone<select className="field-select mt-1 w-full" value={s.timeZone} onChange={(e) => patch({ timeZone: e.target.value })}>{[...new Set([s.timeZone, "UTC", ...Intl.supportedValuesOf("timeZone")])].sort().map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">Times below use {s.timeZone}. Changing the zone keeps exact instants and changes how daily windows are interpreted. A date-only deadline stays date-only unless you set an exact time.</p>
      <label className="block space-y-1 text-xs">Work date (optional, separate from deadline)<Input type="date" value={s.workDate ?? ""} onChange={(e) => patch({ workDate: e.target.value || null })}/></label>
      <div className="grid gap-3 sm:grid-cols-2">{([["deadlineAt", "Exact deadline (optional)"], ["earliestStart", "Earliest start"], ["fixedStart", "Fixed block start"], ["fixedEnd", "Fixed block end"]] as const).map(([key, title]) => <label key={key} className="space-y-1 text-xs">{title}<Input type="datetime-local" value={local(s[key])} onChange={(e) => timed(key, e.target.value)}/></label>)}</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs">Remaining minutes (blank = estimate)<Input type="number" min={0} max={1440} value={s.remainingMinutes ?? ""} onChange={(e) => patch({ remainingMinutes: e.target.value === "" ? null : Number(e.target.value) })}/></label>
        <label className="space-y-1 text-xs">Minimum session minutes<Input type="number" min={5} max={1440} value={s.minimumSessionMinutes} onChange={(e) => patch({ minimumSessionMinutes: Number(e.target.value) })}/></label>
        <label className="space-y-1 text-xs">Preferred session minutes<Input type="number" min={5} max={1440} value={s.preferredSessionMinutes} onChange={(e) => patch({ preferredSessionMinutes: Number(e.target.value) })}/></label>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.splittable} onChange={(e) => patch({ splittable: e.target.checked })}/>Allow splitting across sessions</label>
      <fieldset className="space-y-2"><legend className="mb-2 text-xs font-medium">Finish these tasks first</legend>{dependencies.map((d) => <label key={d.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.dependencies.includes(d.id)} onChange={(e) => patch({ dependencies: e.target.checked ? [...s.dependencies, d.id] : s.dependencies.filter((id) => id !== d.id) })}/>{d.title}</label>)}{s.dependencies.filter((id) => !dependencies.some((d) => d.id === id)).map((id) => <div key={id} className="flex items-center gap-2 text-xs">Unavailable prerequisite ({id})<Button size="sm" type="button" variant="ghost" onClick={() => patch({ dependencies: s.dependencies.filter((d) => d !== id) })}>Remove</Button></div>)}</fieldset>
      {windowFields("allowedWindows", "Hard time limits")}
      {windowFields("preferredWindows", "Preferred times (flexible)")}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-medium">Needs clarification</legend>
        {s.unresolved.map((question, index) => <div key={index} className="flex items-start gap-2">
          <Textarea aria-label={`Clarification question ${index + 1}`} maxLength={500} value={question} onChange={(e) => patch({ unresolved: s.unresolved.map((q, i) => i === index ? e.target.value : q) })}/>
          <Button type="button" variant="ghost" size="sm" onClick={() => patch({ unresolved: s.unresolved.filter((_, i) => i !== index) })}>Remove</Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" disabled={s.unresolved.length >= 20} onClick={() => patch({ unresolved: [...s.unresolved, ""] })}>Add question</Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">Tasks with questions are saved but held out of planning. Edit the details, then remove each resolved question. Repeating tasks and automatic recurring rules are not supported.</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  </details>;
}
