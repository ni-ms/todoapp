import type { Draft } from "./ai-contract";
import type { StudyWindow } from "./task-scheduling";
export interface BenchmarkScore {
    taskCount: boolean;
    fields: {
        name: string;
        passed: boolean;
    }[];
    allPassed: boolean;
}
export interface CaptureChecks {
    clarificationAnyOf?: string[][];
    titleExcludes?: string[][];
    titleAnyOf?: string[][];
}
const equivalent = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) && Array.isArray(b))
        return a.length === b.length && a.every((v, i) => equivalent(v, b[i]));
    if (a && b && typeof a === "object" && typeof b === "object")
        return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => equivalent(v, (b as Record<string, unknown>)[k]));
    if (typeof a === "string" && typeof b === "string" && /T.*(Z|[+-]\d\d:\d\d)$/.test(a) && /T.*(Z|[+-]\d\d:\d\d)$/.test(b))
        return Date.parse(a) === Date.parse(b);
    return a === b;
};
const sameSet = (a: string[], b: string[]) => equivalent([...a].sort(), [...b].sort());
// Compare the actual allowed/preferred minutes, independent of window/day ordering
// and whether a provider expresses one window per day or a shared weekly window.
function canonicalWindows(windows: StudyWindow[]) {
    return Array.from({ length: 7 }, (_, i) => {
        const spans = windows.filter((w) => w.days.includes(i + 1)).map((w) => [w.start, w.end]).sort(([a], [b]) => a.localeCompare(b));
        const merged: string[][] = [];
        for (const [start, end] of spans) {
            const last = merged.at(-1);
            if (last && start <= last[1])
                last[1] = last[1] > end ? last[1] : end;
            else
                merged.push([start, end]);
        }
        return merged;
    });
}
// Optional effort estimates have no single ground-truth numeric value. Explicit
// effort and every hard constraint still require an exact semantic match.
export function scoreCapture(expected: Draft[], actual: Draft[], checks: CaptureChecks = {}): BenchmarkScore {
    const fields: BenchmarkScore["fields"] = [];
    expected.forEach((e, i) => {
        const a = actual[i];
        for (const key of ["priority", "dueDate", "estimateMinutes", "tagIds", "estimatedFields"] as const) {
            const passed = !!a && (key === "estimateMinutes" && e.estimatedFields.includes("estimateMinutes")
                ? a.estimatedFields.includes("estimateMinutes") && Number.isInteger(a.estimateMinutes) && a.estimateMinutes >= 5 && a.estimateMinutes <= 1440
                : key === "estimatedFields" || key === "tagIds" ? sameSet(e[key], a[key]) : equivalent(e[key], a[key]));
            fields.push({ name: `${i}.${key}`, passed });
        }
        for (const key of Object.keys(e.scheduling) as (keyof Draft["scheduling"])[]) {
            const passed = !!a && (key === "unresolved" ? Boolean(e.scheduling.unresolved.length) === Boolean(a.scheduling.unresolved.length)
                : key === "dependencies" ? sameSet(e.scheduling[key], a.scheduling[key])
                    : key === "allowedWindows" || key === "preferredWindows" ? equivalent(canonicalWindows(e.scheduling[key]), canonicalWindows(a.scheduling[key]))
                        : equivalent(e.scheduling[key], a.scheduling[key]));
            fields.push({ name: `${i}.scheduling.${key}`, passed });
        }
        const questionTerms = checks.clarificationAnyOf?.[i];
        if (questionTerms?.length)
            fields.push({ name: `${i}.clarificationMeaning`, passed: !!a && questionTerms.some((term) => a.scheduling.unresolved.join(" ").toLowerCase().includes(term)) });
        const excluded = checks.titleExcludes?.[i];
        if (excluded?.length)
            fields.push({ name: `${i}.correctedTitle`, passed: !!a && excluded.every((term) => !a.title.toLowerCase().includes(term)) });
        const titleTerms = checks.titleAnyOf?.[i];
        if (titleTerms?.length)
            fields.push({ name: `${i}.taskMeaning`, passed: !!a && titleTerms.some((term) => a.title.toLowerCase().includes(term)) });
    });
    return { taskCount: expected.length === actual.length, fields, allPassed: expected.length === actual.length && fields.every((f) => f.passed) };
}
