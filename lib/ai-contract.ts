import { validateTask, type TaskInput } from "./domain";
export interface ContextItem {
  id: string;
  name: string;
  text: string;
  truncated: boolean;
}
export interface Draft {
  title: string;
  description: string;
  priority: TaskInput["priority"];
  dueDate: string | null;
  estimateMinutes: number;
  tagIds: string[];
}
export const taskSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "priority",
          "dueDate",
          "estimateMinutes",
          "tagIds",
        ],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 4000 },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          dueDate: {
            type: ["string", "null"],
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          },
          estimateMinutes: { type: "integer", minimum: 5, maximum: 1440 },
          tagIds: {
            type: "array",
            maxItems: 20,
            uniqueItems: true,
            items: { type: "string" },
          },
        },
      },
    },
  },
};
export function validateDrafts(raw: string, tagIds: string[]): Draft[] {
  if (typeof raw !== "string" || raw.length > 524288)
    throw new Error("The model returned invalid task drafts.");
  const result = JSON.parse(raw);
  if (
    !result ||
    Object.keys(result).join() !== "tasks" ||
    !Array.isArray(result.tasks) ||
    !result.tasks.length ||
    result.tasks.length > 10
  )
    throw new Error("The model must propose 1–10 tasks. Nothing was saved.");
  for (const d of result.tasks) {
    if (
      !d ||
      typeof d.title !== "string" ||
      typeof d.description !== "string" ||
      !(
        d.dueDate === null ||
        (typeof d.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate))
      ) ||
      Object.keys(d).sort().join() !==
        "description,dueDate,estimateMinutes,priority,tagIds,title" ||
      !Array.isArray(d.tagIds) ||
      d.tagIds.length > 20 ||
      new Set(d.tagIds).size !== d.tagIds.length ||
      d.tagIds.some(
        (id: unknown) => typeof id !== "string" || !tagIds.includes(id),
      )
    )
      throw new Error(
        "The model proposed invalid task fields, a non-date deadline, or unknown/repeated tags. Nothing was saved. Try a clearer request or another model.",
      );
    validateTask({ ...d, courseId: null, kind: "study", status: "todo" });
  }
  const titles = result.tasks.map((d: Draft) =>
    d.title.trim().toLocaleLowerCase(),
  );
  if (new Set(titles).size !== titles.length)
    throw new Error(
      "The model repeated a task. Nothing was saved. Try a clearer request or another model.",
    );
  return result.tasks;
}
export function allowedContext(name: string, size: number) {
  const parts = name.toLowerCase().split("/");
  if (
    size > 128000 ||
    parts.length > 6 ||
    parts.some(
      (p) =>
        p.startsWith(".") ||
        [
          "node_modules",
          "target",
          "dist",
          "build",
          "out",
          "vendor",
          "venv",
        ].includes(p),
    )
  )
    return false;
  const file = parts.at(-1)!;
  if (
    [
      "secret",
      "credential",
      "token",
      "password",
      "package-lock",
      "cargo.lock",
    ].some((s) => file.includes(s))
  )
    return false;
  return (
    /\.(txt|md|mdx|rs|py|js|jsx|ts|tsx|html|css|toml|yaml|yml|csv|java|c|cpp|h|go|swift)$/.test(
      file,
    ) || ["readme", "license"].includes(file)
  );
}
