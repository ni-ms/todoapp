import { Temporal } from "temporal-polyfill";
import contract from "./capture-contract.json";
export interface StudyWindow {
    days: number[];
    start: string;
    end: string;
}
export interface TaskScheduling {
    timeZone: string;
    workDate: string | null;
    deadlineAt: string | null;
    earliestStart: string | null;
    fixedStart: string | null;
    fixedEnd: string | null;
    remainingMinutes: number | null;
    dependencies: string[];
    splittable: boolean;
    minimumSessionMinutes: number;
    preferredSessionMinutes: number;
    allowedWindows: StudyWindow[];
    preferredWindows: StudyWindow[];
    unresolved: string[];
}
export function defaultScheduling(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): TaskScheduling {
    return { timeZone, workDate: null, deadlineAt: null, earliestStart: null, fixedStart: null, fixedEnd: null, remainingMinutes: null, dependencies: [], splittable: true, minimumSessionMinutes: 5, preferredSessionMinutes: 90, allowedWindows: [], preferredWindows: [], unresolved: [] };
}
// Small strict schema validator shared with the native contract, including required nulls.
export function checkContract(value: unknown, schema: Record<string, unknown>): void {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
    if (!types.includes(type))
        throw new Error("Invalid scheduling field type.");
    if (schema.enum && !(schema.enum as unknown[]).includes(value))
        throw new Error("Invalid field value.");
    if (type === "object") {
        const object = value as Record<string, unknown>, props = schema.properties as Record<string, Record<string, unknown>>;
        if ((schema.required as string[]).some((key) => !Object.hasOwn(object, key)) || Object.keys(object).some((key) => !props[key]))
            throw new Error("Missing or unsupported fields.");
        for (const [key, item] of Object.entries(object))
            checkContract(item, props[key]);
    }
    else if (type === "array") {
        const array = value as unknown[];
        if (array.length < Number(schema.minItems ?? 0) || array.length > Number(schema.maxItems ?? Infinity) || (schema.uniqueItems && new Set(array.map((v) => JSON.stringify(v))).size !== array.length))
            throw new Error("Invalid or repeated list entries.");
        for (const item of array)
            checkContract(item, schema.items as Record<string, unknown>);
    }
    else if (type === "integer") {
        if (Number(value) < Number(schema.minimum ?? -Infinity) || Number(value) > Number(schema.maximum ?? Infinity))
            throw new Error("Scheduling minutes are out of range.");
    }
    else if (type === "string") {
        const s = value as string;
        if (s.length < Number(schema.minLength ?? 0) || s.length > Number(schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(String(schema.pattern)).test(s)))
            throw new Error("Invalid text or date format.");
    }
}
export function validateScheduling(s: TaskScheduling, estimate: number) {
    checkContract(s, contract.schema.properties.tasks.items.properties.scheduling);
    if (/^[+-]/.test(s.timeZone))
        throw new Error("Choose an IANA time zone.");
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone });
    Temporal.Now.zonedDateTimeISO(s.timeZone);
    if (s.workDate && Temporal.PlainDate.from(s.workDate, { overflow: "reject" }).toString() !== s.workDate)
        throw new Error("Invalid work date.");
    for (const value of [s.deadlineAt, s.earliestStart, s.fixedStart, s.fixedEnd]) {
        if (value !== null) {
            if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
                throw new Error("Use an exact time with a time zone offset.");
            Temporal.Instant.from(value);
        }
    }
    if (s.fixedStart && (Date.parse(s.fixedEnd!) - Date.parse(s.fixedStart)) % 60000 !== 0)
        throw new Error("Fixed block duration must be a whole number of minutes.");
    if (s.minimumSessionMinutes > s.preferredSessionMinutes || (s.remainingMinutes !== null && s.remainingMinutes > estimate))
        throw new Error("Check remaining effort and session lengths.");
    if (Boolean(s.fixedStart) !== Boolean(s.fixedEnd) || (s.fixedStart && Date.parse(s.fixedEnd!) <= Date.parse(s.fixedStart)))
        throw new Error("A fixed block needs a start and a later end.");
    if (s.earliestStart && s.deadlineAt && Date.parse(s.earliestStart) >= Date.parse(s.deadlineAt))
        throw new Error("Earliest start must precede the deadline.");
    if (s.fixedStart && ((s.earliestStart && Date.parse(s.fixedStart) < Date.parse(s.earliestStart)) || (s.deadlineAt && Date.parse(s.fixedEnd!) > Date.parse(s.deadlineAt))))
        throw new Error("The fixed block conflicts with the start or deadline.");
    for (const w of [...s.allowedWindows, ...s.preferredWindows])
        if (w.start >= w.end)
            throw new Error("Time windows must end after they start; split overnight windows.");
}
