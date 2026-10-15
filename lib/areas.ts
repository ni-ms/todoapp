import type { Area, CalendarEvent, Tag, Task } from "./domain";

export function areaTagIds(area: Area | undefined, tags: Tag[]): string[] {
  return area?.tagIds.filter((id) => tags.some((tag) => tag.id === id && !tag.deletedAt)) ?? [];
}
export function taskInArea(task: Task, tagIds: string[] | null): boolean {
  return tagIds === null || task.tagIds.some((id) => tagIds.includes(id));
}
// Sessions inherit their task's tags as well as their own.
export function eventInArea(event: CalendarEvent, tagIds: string[] | null, tasks: Task[]): boolean {
  return tagIds === null || event.tagIds.some((id) => tagIds.includes(id)) || tasks.some(
    (task) => !task.deletedAt && task.id === event.taskId && taskInArea(task, tagIds),
  );
}
