import {
  unifyTags,
  purgeFromWorkspace,
  type TrashEntity,
} from "./organization";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  type Workspace,
  type AreaInput,
  type CourseInput,
  type TaskInput,
  type TagInput,
  type EventInput,
  defaultTags,
  defaultTagIds,
  validateTag,
  validateEvent,
  validateCourse,
  validateTask,
  emptyWorkspace,
} from "./domain";

export const isDesktop = () => typeof window !== "undefined" && isTauri();
export interface WorkspaceStorage {
  load(): Promise<Workspace>;
  saveArea(input: AreaInput): Promise<Workspace>;
  saveCourse(input: CourseInput): Promise<Workspace>;
  saveTask(input: TaskInput): Promise<Workspace>;
  purgeRecord(entity: TrashEntity, id: string): Promise<Workspace>;
  saveTasks(inputs: TaskInput[]): Promise<Workspace>;
  saveTag(input: TagInput): Promise<Workspace>;
  deleteTag(id: string): Promise<Workspace>;
  saveEvent(input: EventInput): Promise<Workspace>;
  setDeleted(
    entity: "task" | "course" | "tag" | "event" | "area",
    id: string,
    deleted: boolean,
  ): Promise<Workspace>;
}
const native: WorkspaceStorage = {
  saveArea: (input) => invoke("save_area", { input }),
  purgeRecord: (entity, id) => invoke("purge_record", { entity, id }),
  saveTasks: (inputs) => invoke("save_tasks", { inputs }),
  load: () => invoke("load_workspace"),
  saveCourse: (input) => invoke("save_course", { input }),
  saveTask: (input) => invoke("save_task", { input }),
  saveTag: (input) => invoke("save_tag", { input }),
  deleteTag: (id) => invoke("delete_tag", { id }),
  saveEvent: (input) => invoke("save_event", { input }),
  setDeleted: (entity, id, deleted) =>
    invoke("set_deleted", { entity, id, deleted }),
};

// A separate, clearly labelled browser preview. It never substitutes for failed native storage.
let browserDatabase: Promise<IDBDatabase> | undefined;
export function openPreview() {
  if (!browserDatabase)
    browserDatabase = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("daymark-browser-preview", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("workspace");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          browserDatabase = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        browserDatabase = undefined;
        reject(
          new Error(
            "Browser storage is unavailable. Use the desktop app or enable local browser storage.",
          ),
        );
      };
      request.onblocked = () => {
        browserDatabase = undefined;
        reject(new Error("Close older preview tabs, then retry."));
      };
    });
  return browserDatabase;
}
export interface BrowserPlanMetadata {
  lastPlan?: { id: string; revision: string }[];
}
export async function previewTransaction(
  mutate?: (workspace: Workspace, metadata: BrowserPlanMetadata) => void,
): Promise<Workspace> {
  const database = await openPreview();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("workspace", "readwrite");
    const store = transaction.objectStore("workspace");
    const request = store.get("current");
    const metadataRequest = store.get("planner");
    let workspace: Workspace;
    let reason: unknown;
    metadataRequest.onsuccess = () => {
      try {
        workspace = request.result ?? emptyWorkspace();
        if (
          !Array.isArray(workspace.tasks) ||
          !Array.isArray(workspace.courses)
        )
          throw new Error(
            "Preview data could not be read. Existing storage was preserved.",
          );
        workspace.tags ??= defaultTags();
        workspace.events ??= [];
        workspace.tasks.forEach(
          (task) => (task.tagIds ??= defaultTagIds(task.kind)),
        );
        unifyTags(workspace);
        workspace.areas ??= workspace.tags.filter((t) => !t.deletedAt).map((t) => ({ id: "area-" + t.id, name: t.name, color: t.color, icon: t.icon, tagIds: [t.id], createdAt: t.createdAt, updatedAt: t.updatedAt, deletedAt: null }));
        const metadata: BrowserPlanMetadata = metadataRequest.result ?? {};
        mutate?.(workspace, metadata);
        unifyTags(workspace);
        store.put(workspace, "current");
        store.put(metadata, "planner");
      } catch (error) {
        reason = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(workspace);
    transaction.onabort = transaction.onerror = () =>
      reject(
        reason ??
          new Error(
            "Could not save browser preview data. Your changes were not applied.",
          ),
      );
  });
}
const preview: WorkspaceStorage = {
  saveArea: (input) => previewTransaction((w) => {
    validateTag(input);
    if (!input.tagIds.length) throw new Error("Choose at least one tag for this area.");
    const old = input.id ? w.areas.find((a) => a.id === input.id && !a.deletedAt) : undefined;
    if (input.id && !old) throw new Error("Area is no longer available.");
    checkTags(w, input.tagIds, old?.tagIds ?? []);
    if (w.areas.some((a) => !a.deletedAt && a.id !== input.id && a.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error("An area with this name already exists.");
    const now = new Date().toISOString();
    const value = { ...input, name: input.name.trim(), id: old?.id ?? crypto.randomUUID(), createdAt: old?.createdAt ?? now, updatedAt: now, deletedAt: null };
    if (old) Object.assign(old, value); else w.areas.push(value);
  }),
  purgeRecord: (entity, id) =>
    previewTransaction((w) => purgeFromWorkspace(w, entity, id)),
  saveTasks: (inputs) =>
    previewTransaction((w) => {
      if (!inputs.length || inputs.length > 20 || inputs.some((i) => i.id))
        throw new Error("Choose 1–20 new tasks.");
      for (const input of inputs) {
        validateTask(input);
        checkTags(w, input.tagIds ?? [], []);
        if (input.courseId) throw new Error("Choose tags instead of a course.");
      }
      const now = new Date().toISOString();
      const ids = inputs.map(() => crypto.randomUUID());
      const resolved = inputs.map((input) => ({ ...input, scheduling: input.scheduling ? { ...input.scheduling, dependencies: input.scheduling.dependencies.map((id) => { if (!id.startsWith("draft:")) return id; const index = Number(id.slice(6)); if (!Number.isInteger(index) || !ids[index]) throw new Error("Unknown draft dependency."); return ids[index]; }) } : input.scheduling }));
      w.tasks.push(
        ...resolved.map((input, i) => ({
          ...input,
          id: ids[i],
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          tagIds: input.tagIds ?? [],
        })),
      );
    }),
  deleteTag: (id) =>
    previewTransaction((workspace) => {
      if (!workspace.tags.some((tag) => tag.id === id && tag.deletedAt))
        throw new Error("Only archived tags can be permanently deleted.");
      workspace.tags = workspace.tags.filter((tag) => tag.id !== id);
      const now = new Date().toISOString();
      for (const record of [...workspace.tasks, ...workspace.events, ...workspace.areas]) {
        if (record.tagIds.includes(id)) {
          record.tagIds = record.tagIds.filter((tagId) => tagId !== id);
          record.updatedAt = now;
        }
      }
    }),
  load: () => previewTransaction(),
  saveCourse: (input) =>
    previewTransaction((workspace) => {
      validateCourse(input);
      const existing = input.id
        ? workspace.courses.find(
            (course) => course.id === input.id && !course.deletedAt,
          )
        : undefined;
      if (input.id && !existing)
        throw new Error(
          "This area is no longer available. Refresh your workspace.",
        );
      const now = new Date().toISOString();
      const value = {
        ...input,
        name: input.name.trim(),
        code: input.code.trim(),
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      if (existing) Object.assign(existing, value);
      else workspace.courses.push(value);
    }),
  saveTask: (input) =>
    previewTransaction((workspace) => {
      validateTask(input);
      const existing = input.id
        ? workspace.tasks.find(
            (task) => task.id === input.id && !task.deletedAt,
          )
        : undefined;
      if (input.id && !existing)
        throw new Error(
          "This task is no longer available. Refresh your workspace.",
        );
      if (
        input.courseId &&
        input.courseId !== existing?.courseId &&
        !workspace.courses.some(
          (course) => course.id === input.courseId && !course.deletedAt,
        )
      )
        throw new Error("Choose an active course or project.");
      checkTags(
        workspace,
        input.tagIds ?? existing?.tagIds ?? defaultTagIds(input.kind),
        existing?.tagIds ?? [],
      );
      const now = new Date().toISOString();
      const value = {
        ...input,
        title: input.title.trim(),
        tagIds: input.tagIds ?? existing?.tagIds ?? defaultTagIds(input.kind),
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      if (existing) Object.assign(existing, value);
      else workspace.tasks.push(value);
    }),
  saveTag: (input) =>
    previewTransaction((workspace) => {
      validateTag(input);
      if (
        workspace.tags.some(
          (t) =>
            !t.deletedAt &&
            t.id !== input.id &&
            t.name.toLowerCase() === input.name.trim().toLowerCase(),
        )
      )
        throw new Error("A tag with this name already exists.");
      const existing = input.id
        ? workspace.tags.find((t) => t.id === input.id && !t.deletedAt)
        : undefined;
      if (input.id && !existing) throw new Error("Tag is no longer available.");
      const now = new Date().toISOString();
      const value = {
        ...input,
        name: input.name.trim(),
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      if (existing) Object.assign(existing, value);
      else workspace.tags.push(value);
    }),
  saveEvent: (input) =>
    previewTransaction((workspace) => {
      validateEvent(input);
      const existing = input.id
        ? workspace.events.find((e) => e.id === input.id && !e.deletedAt)
        : undefined;
      if (input.id && !existing)
        throw new Error("Event is no longer available.");
      checkTags(workspace, input.tagIds, existing?.tagIds ?? []);
      if (
        input.taskId &&
        !workspace.tasks.some((t) => t.id === input.taskId && !t.deletedAt)
      )
        throw new Error("Task is no longer available.");
      const now = new Date().toISOString();
      const value = {
        ...input,
        title: input.title.trim(),
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      if (existing) Object.assign(existing, value);
      else workspace.events.push(value);
    }),
  setDeleted: (entity, id, deleted) =>
    previewTransaction((workspace) => {
      const records =
        entity === "area" ? workspace.areas : entity === "task"
          ? workspace.tasks
          : entity === "course"
            ? workspace.courses
            : entity === "tag"
              ? workspace.tags
              : workspace.events;
      const record = records.find(
        (record) => record.id === id && Boolean(record.deletedAt) !== deleted,
      );
      if (!record)
        throw new Error(
          "This record is no longer available. Refresh your workspace.",
        );
      if (
        ["tag", "area"].includes(entity) &&
        !deleted &&
        (entity === "area" ? workspace.areas : workspace.tags).some(
          (t) =>
            t.id !== id &&
            !t.deletedAt &&
            t.name.toLowerCase() ===
              (record as (typeof workspace.tags)[number]).name.toLowerCase(),
        )
      )
        throw new Error(
          "Another active tag has this name. Rename it before restoring.",
        );
      record.deletedAt = deleted ? new Date().toISOString() : null;
      record.updatedAt = new Date().toISOString();
    }),
};
export function storage(): WorkspaceStorage {
  return isDesktop() ? native : preview;
}
export async function exportWorkspace(
  workspace: Workspace,
): Promise<string | undefined> {
  if (isDesktop()) return invoke<string>("export_workspace");
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: "daymark-workspace",
          version: 2,
          exportedAt: new Date().toISOString(),
          ...workspace,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `daymark-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function loadPreviewExample(): Promise<Workspace> {
  if (isDesktop())
    return Promise.reject(
      new Error("Example data is only available in browser preview."),
    );
  return previewTransaction((workspace) => {
    if (workspace.tasks.length || workspace.courses.length)
      throw new Error(
        "Examples are available only in an empty preview workspace.",
      );
    const now = new Date().toISOString();
    const areas: CourseInput[] = [
      {
        name: "Data Structures & Algorithms",
        code: "CS 201",
        kind: "course",
        color: "violet",
        description: "Think clearly. Build a stronger foundation.",
      },
      {
        name: "Personal portfolio",
        code: "SIDE PROJECT",
        kind: "project",
        color: "blue",
        description: "A home for the things I’m proud to build.",
      },
      {
        name: "Land a developer internship",
        code: "CAREER",
        kind: "career",
        color: "emerald",
        description: "Small, consistent steps toward a first tech role.",
      },
    ];
    areas.forEach((area) =>
      workspace.courses.push({
        ...area,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const tasks: TaskInput[] = [
      {
        title: "Practice binary tree traversals",
        description:
          "Implement preorder, inorder, and postorder. Explain their time complexity.",
        courseId: workspace.courses[0].id,
        kind: "study",
        status: "doing",
        priority: "high",
        dueDate: day(0),
        estimateMinutes: 45,
      },
      {
        title: "Build the portfolio project page",
        description: "Tell the story: problem, decisions, and what I learned.",
        courseId: workspace.courses[1].id,
        kind: "coding",
        status: "todo",
        priority: "medium",
        dueDate: day(0),
        estimateMinutes: 90,
      },
      {
        title: "Refine my resume’s project section",
        description: "Add concrete outcomes and links to the repositories.",
        courseId: workspace.courses[2].id,
        kind: "career",
        status: "todo",
        priority: "medium",
        dueDate: day(0),
        estimateMinutes: 30,
      },
      {
        title: "Finish problem set 04",
        description: "Graphs, shortest paths, and complexity analysis.",
        courseId: workspace.courses[0].id,
        kind: "assignment",
        status: "todo",
        priority: "high",
        dueDate: day(2),
        estimateMinutes: 120,
      },
      {
        title: "Add responsive navigation",
        description: "Test at narrow widths and with keyboard navigation.",
        courseId: workspace.courses[1].id,
        kind: "coding",
        status: "todo",
        priority: "low",
        dueDate: day(3),
        estimateMinutes: 60,
      },
      {
        title: "Review sorting algorithm notes",
        description:
          "Compare the tradeoffs without looking at the notes first.",
        courseId: workspace.courses[0].id,
        kind: "study",
        status: "done",
        priority: "medium",
        dueDate: day(0),
        estimateMinutes: 25,
      },
    ];
    tasks.forEach((task) =>
      workspace.tasks.push({
        ...task,
        tagIds: task.tagIds ?? defaultTagIds(task.kind),
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  });
}

function checkTags(workspace: Workspace, ids: string[], existing: string[]) {
  if (ids.length > 20 || new Set(ids).size !== ids.length)
    throw new Error("Choose at most 20 distinct tags.");
  if (
    ids.some(
      (id) =>
        !existing.includes(id) &&
        !workspace.tags.some((t) => t.id === id && !t.deletedAt),
    )
  )
    throw new Error("Choose an active tag.");
}
export function downloadFile(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
