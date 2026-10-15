import type { Workspace } from "./domain";
export function unifyTags(workspace: Workspace) {
  if (workspace.organizationVersion === 1 && !workspace.courses.length) return;
  for (const course of workspace.courses) {
    const id = "course-" + course.id;
    if (!workspace.tags.some((t) => t.id === id))
      workspace.tags.push({
        ...course,
        id,
        icon:
          course.kind === "course"
            ? "book"
            : course.kind === "project"
              ? "code"
              : "briefcase",
      });
    for (const task of workspace.tasks.filter(
      (t) => t.courseId === course.id,
    )) {
      if (!task.tagIds.includes(id)) task.tagIds.push(id);
      for (const event of workspace.events.filter((e) => e.taskId === task.id))
        if (!event.tagIds.includes(id)) event.tagIds.push(id);
      task.courseId = null;
    }
  }
  workspace.courses = [];
  workspace.organizationVersion = 1;
}
export type TrashEntity = "task" | "course" | "event" | "tag" | "area";
export function purgeFromWorkspace(
  workspace: Workspace,
  entity: TrashEntity,
  id: string,
) {
  const records =
    entity === "area" ? workspace.areas : entity === "task"
      ? workspace.tasks
      : entity === "course"
        ? workspace.courses
        : entity === "event"
          ? workspace.events
          : workspace.tags;
  const record = records.find((r) => r.id === id && r.deletedAt);
  if (!record)
    throw new Error("Only items in Trash can be permanently deleted.");
  const now = new Date().toISOString();
  if (entity === "task") {
    workspace.tasks = workspace.tasks.filter((t) => t.id !== id);
    for (const e of workspace.events)
      if (e.taskId === id) {
        e.taskId = null;
        e.updatedAt = now;
      }
  }
  if (entity === "area") workspace.areas = workspace.areas.filter((a) => a.id !== id);
  if (entity === "event")
    workspace.events = workspace.events.filter((e) => e.id !== id);
  if (entity === "course") {
    workspace.courses = workspace.courses.filter((c) => c.id !== id);
    for (const t of workspace.tasks)
      if (t.courseId === id) {
        t.courseId = null;
        t.updatedAt = now;
      }
  }
  if (entity === "tag") {
    workspace.tags = workspace.tags.filter((t) => t.id !== id);
    for (const r of [...workspace.tasks, ...workspace.events, ...workspace.areas])
      if (r.tagIds.includes(id)) {
        r.tagIds = r.tagIds.filter((t) => t !== id);
        r.updatedAt = now;
      }
  }
}
