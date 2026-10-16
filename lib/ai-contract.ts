import { resolveCapture, type CaptureContext } from "./capture-resolution";
import contract from "./capture-contract.json";
import { Temporal } from "temporal-polyfill";
import { checkContract, type TaskScheduling } from "./task-scheduling";
import { validateTask, type TaskInput } from "./domain";
export interface ContextItem {
    id: string;
    name: string;
    text: string;
    truncated: boolean;
}
export interface Draft {
    scheduling: TaskScheduling;
    estimatedFields: ("estimateMinutes" | "priority")[];
    title: string;
    description: string;
    priority: TaskInput["priority"];
    dueDate: string | null;
    estimateMinutes: number;
    tagIds: string[];
}
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key: string, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
export const taskSchema = contract.schema;
export function capturePrompt(today: string, timeZone: string, now: string, tags: {
    id: string;
    name: string;
}[]) {
    const date = Temporal.PlainDate.from(today);
    const upcomingDates = Array.from({ length: 8 }, (_, i) => { const d = date.add({ days: i }); return { weekday: contract.weekdayNames[d.dayOfWeek - 1], date: d.toString() }; });
    return `${contract.instructions}\nDate context: ${canonicalJson({ now, today, tomorrow: date.add({ days: 1 }).toString(), timeZone, upcomingDates })}\nActive tags: ${canonicalJson(tags)}.`;
}
export function captureMessages(text: string, contexts: {
    file: string;
    excerpt: string;
}[], calendarContext: unknown[], today: string, timeZone: string, now: string, tags: {
    id: string;
    name: string;
}[]) {
    return [
        { role: "system" as const, content: capturePrompt(today, timeZone, now, tags) },
        ...contract.examples.flatMap((example) => [
            { role: "user" as const, content: canonicalJson({ request: example.request, fileExcerpts: [], calendarContext: [] }) },
            { role: "assistant" as const, content: canonicalJson({ tasks: example.tasks.map((task) => ({ ...task, scheduling: { ...task.scheduling, timeZone } })) }) },
        ]),
        { role: "user" as const, content: canonicalJson({ request: text, fileExcerpts: contexts, calendarContext }) },
    ];
}
export function validateDrafts(raw: string, tagIds: string[]): Draft[] {
    if (typeof raw !== "string" || raw.length > 524288)
        throw new Error("The model returned invalid task drafts.");
    const result = JSON.parse(raw);
    checkContract(result, taskSchema);
    for (const d of result.tasks as Draft[]) {
        if (d.tagIds.some((id) => !tagIds.includes(id)))
            throw new Error("The model proposed unknown tags. Nothing was saved.");
        validateTask({ ...d, courseId: null, kind: "study", status: "todo" });
        if (d.scheduling.dependencies.some((id) => !/^draft:[0-9]+$/.test(id) || Number(id.slice(6)) >= result.tasks.length))
            throw new Error("Unknown draft dependency.");
    }
    const titles = result.tasks.map((d: Draft) => d.title.trim().toLowerCase());
    if (new Set(titles).size !== titles.length)
        throw new Error("The model repeated a task. Nothing was saved.");
    return result.tasks;
}
export function interpretDrafts(raw: string, tagIds: string[], request: string, context: CaptureContext): Draft[] {
    const drafts = resolveCapture(validateDrafts(raw, tagIds), request, context);
    return validateDrafts(JSON.stringify({ tasks: drafts }), tagIds);
}
export function allowedContext(name: string, size: number) {
    const parts = name.toLowerCase().split("/");
    if (size > 128000 ||
        parts.length > 6 ||
        parts.some((p) => p.startsWith(".") ||
            [
                "node_modules",
                "target",
                "dist",
                "build",
                "out",
                "vendor",
                "venv",
            ].includes(p)))
        return false;
    const file = parts.at(-1)!;
    if ([
        "secret",
        "credential",
        "token",
        "password",
        "package-lock",
        "cargo.lock",
    ].some((s) => file.includes(s)))
        return false;
    return (/\.(txt|md|mdx|rs|py|js|jsx|ts|tsx|html|css|toml|yaml|yml|csv|java|c|cpp|h|go|swift)$/.test(file) || ["readme", "license"].includes(file));
}
