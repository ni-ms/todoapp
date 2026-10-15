export type AreaKind = "course" | "project" | "career";
export type Color = "violet" | "blue" | "emerald" | "amber" | "rose";
export type TaskKind =
  | "study"
  | "assignment"
  | "coding"
  | "career"
  | "personal";
export type Status = "todo" | "doing" | "done";
export type Priority = "low" | "medium" | "high";
interface RecordMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface Course extends RecordMetadata {
  name: string;
  code: string;
  kind: AreaKind;
  color: Color;
  description: string;
}
export interface Task extends RecordMetadata {
  title: string;
  description: string;
  courseId: string | null;
  kind: TaskKind;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  estimateMinutes: number;
  tagIds: string[];
}
export type CourseInput = Omit<Course, keyof RecordMetadata> & { id?: string };
export type TaskInput = Omit<Task, keyof RecordMetadata | "tagIds"> & {
  id?: string;
  tagIds?: string[];
};
export interface Area extends RecordMetadata {
  name: string; color: Color; icon: string; tagIds: string[];
}
export type AreaInput = Omit<Area, keyof RecordMetadata> & { id?: string };
export interface Workspace {
  areas: Area[];
  courses: Course[];
  tasks: Task[];
  tags: Tag[];
  events: CalendarEvent[];
  organizationVersion?: number;
}
export const emptyWorkspace = (): Workspace => ({
  areas: [],
  courses: [],
  tasks: [],
  tags: defaultTags(),
  events: [],
});
export const areaLabels: Record<AreaKind, string> = {
  course: "Course",
  project: "Coding project",
  career: "Career goal",
};
export const taskLabels: Record<TaskKind, string> = {
  study: "Study",
  assignment: "Assignment",
  coding: "Coding",
  career: "Career prep",
  personal: "Personal",
};
export const statusLabels: Record<Status, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Completed",
};
export const colors: Color[] = ["violet", "blue", "emerald", "amber", "rose"];
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
// Deadlines are local calendar dates, not instants. Parsing as UTC shifts days west of UTC.
export function formatDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`;
}
export function taskInput(task: Task): TaskInput {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    courseId: task.courseId,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    estimateMinutes: task.estimateMinutes,
    tagIds: task.tagIds,
  };
}
export function courseInput(course: Course): CourseInput {
  return {
    id: course.id,
    name: course.name,
    code: course.code,
    kind: course.kind,
    color: course.color,
    description: course.description,
  };
}
export function validateCourse(input: CourseInput) {
  if (!input.name.trim() || input.name.trim().length > 200)
    throw new Error("Enter a name between 1 and 200 characters.");
  if (input.code.length > 30 || input.description.length > 4000)
    throw new Error("The code or description is too long.");
  if (!Object.hasOwn(areaLabels, input.kind) || !colors.includes(input.color))
    throw new Error("Invalid area type or color.");
}
export function validateTask(input: TaskInput) {
  if (!input.title.trim() || input.title.trim().length > 200)
    throw new Error("Enter a title between 1 and 200 characters.");
  if (input.description.length > 4000)
    throw new Error("Keep the description under 4,000 characters.");
  if (
    !Object.hasOwn(taskLabels, input.kind) ||
    !Object.hasOwn(statusLabels, input.status) ||
    !["low", "medium", "high"].includes(input.priority)
  )
    throw new Error("Invalid task type, status, or priority.");
  if (
    !Number.isInteger(input.estimateMinutes) ||
    input.estimateMinutes < 5 ||
    input.estimateMinutes > 1440
  )
    throw new Error("Duration must be between 5 and 1,440 minutes.");
  if (input.dueDate) {
    const date = new Date(`${input.dueDate}T12:00:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
      Number.isNaN(date.getTime()) ||
      localDate(date) !== input.dueDate
    )
      throw new Error("Enter a valid due date.");
  }
}

export interface Tag extends RecordMetadata {
  name: string;
  color: Color;
  icon: string;
  description?: string;
  code?: string;
  kind?: "label" | AreaKind;
}
export type TagInput = Pick<
  Tag,
  "name" | "color" | "icon" | "description" | "code" | "kind"
> & { id?: string };
export interface CalendarEvent extends RecordMetadata {
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string;
  tagIds: string[];
  taskId: string | null;
}
export type EventInput = Omit<CalendarEvent, keyof RecordMetadata> & {
  id?: string;
};
export const presetIcons = [
  "book",
  "code",
  "briefcase",
  "brain",
  "flask",
  "heart",
  "dumbbell",
  "music",
  "palette",
  "globe",
  "star",
  "coffee",
  "hash",
  "target",
] as const;
export const defaultTagIds = (kind: TaskKind) =>
  kind === "coding"
    ? ["tag-building"]
    : kind === "career"
      ? ["tag-career"]
      : ["study", "assignment"].includes(kind)
        ? ["tag-learning"]
        : [];
export function defaultTags(): Tag[] {
  return (
    [
      ["tag-learning", "Learning", "violet", "book"],
      ["tag-building", "Building", "blue", "code"],
      ["tag-career", "Career", "emerald", "briefcase"],
    ] as const
  ).map(([id, name, color, icon]) => ({
    id,
    name,
    color,
    icon,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    deletedAt: null,
  }));
}
export function validateTag(value: TagInput) {
  if (!value.name.trim() || value.name.trim().length > 200)
    throw new Error("Tag names must be 1–200 characters.");
  if (
    (value.description?.length ?? 0) > 4000 ||
    (value.code?.length ?? 0) > 30 ||
    (value.kind &&
      !["label", "course", "project", "career"].includes(value.kind))
  )
    throw new Error("Invalid tag details.");
  if (!colors.includes(value.color)) throw new Error("Choose a tag color.");
  if (
    !(presetIcons as readonly string[]).includes(value.icon) &&
    (!value.icon.startsWith("data:image/png;base64,") ||
      value.icon.length > 90022)
  )
    throw new Error("Choose a preset or upload an icon.");
}
export function validateEvent(value: EventInput) {
  if (!value.title.trim() || value.title.trim().length > 200)
    throw new Error("Enter an event title (1–200 characters).");
  if (value.description.length > 4000)
    throw new Error("Keep notes under 4,000 characters.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(
      new Date(),
    );
  } catch {
    throw new Error("Choose a valid time zone.");
  }
  if (value.allDay) {
    for (const date of [value.start, value.end]) {
      const d = new Date(date + "T12:00:00");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(d.getTime()) ||
        localDate(d) !== date
      )
        throw new Error("Choose valid dates.");
    }
  } else if (
    !/Z$|[+-]\d\d:\d\d$/.test(value.start) ||
    !/Z$|[+-]\d\d:\d\d$/.test(value.end)
  ) {
    throw new Error("Choose valid event times.");
  }
  const span = Date.parse(value.end) - Date.parse(value.start);
  if (
    !Number.isFinite(span) ||
    span < (value.allDay ? 86400000 : 60000) ||
    span > 366 * 86400000
  )
    throw new Error("End must follow start, within one year.");
}
export function eventInput(event: CalendarEvent): EventInput {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    timeZone: event.timeZone,
    tagIds: event.tagIds,
    taskId: event.taskId,
  };
}
