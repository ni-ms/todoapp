"use client";
import { useState, type FormEvent } from "react";
import { BookOpen, Code2, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  colors,
  areaLabels,
  statusLabels,
  validateCourse,
  validateTask,
  taskInput,
  courseInput,
  type Course,
  type CourseInput,
  type Task,
  type TaskInput,
  type AreaKind,
} from "@/lib/domain";
import { SchedulingFields } from "@/components/scheduling-fields";
import { TagPicker } from "@/components/tag-manager";
import type { Tag } from "@/lib/domain";
import { cn } from "@/lib/utils";

interface FormProps<T> {
  busy: boolean;
  onSave: (input: T) => Promise<void>;
  onCancel: () => void;
}
export function TaskForm({
  task,
  tasks = [],
  defaultTag,
  tags,
  busy,
  onSave,
  onCancel,
}: FormProps<TaskInput> & {
  task?: Task;
  tasks?: Task[];
  defaultTag?: string;
  tags: Tag[];
}) {
  const [value, setValue] = useState<TaskInput>(() =>
    task
      ? taskInput(task)
      : {
          title: "",
          description: "",
          courseId: null,
          kind: "study",
          status: "todo",
          priority: "medium",
          dueDate: null,
          estimateMinutes: 30,
          tagIds: defaultTag
            ? [defaultTag]
            : tags.some((t) => t.id === "tag-learning" && !t.deletedAt)
              ? ["tag-learning"]
              : [],
        },
  );
  const [error, setError] = useState("");
  const set = <K extends keyof TaskInput>(key: K, next: TaskInput[K]) =>
    setValue((previous) => ({ ...previous, [key]: next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      validateTask(value);
      await onSave(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription className="sr-only">Task details</DialogDescription>
      </DialogHeader>
      <fieldset disabled={busy} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="task-title">Task title</Label>
          <Input
            id="task-title"
            autoFocus
            required
            maxLength={200}
            placeholder="What would you like to work on?"
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Tags</Label>
          <TagPicker
            tags={tags}
            value={value.tagIds ?? []}
            onChange={(ids) => set("tagIds", ids)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="task-due">
              Due date{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="task-due"
              type="date"
              value={value.dueDate ?? ""}
              onChange={(e) => set("dueDate", e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-duration">Estimated minutes</Label>
            <Input
              id="task-duration"
              type="number"
              min={5}
              max={1440}
              step={1}
              required
              value={value.estimateMinutes}
              onChange={(e) =>
                set(
                  "estimateMinutes",
                  e.target.value === "" ? 0 : Number(e.target.value),
                )
              }
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="task-priority">Priority</Label>
            <select
              id="task-priority"
              className="field-select"
              value={value.priority}
              onChange={(e) =>
                set("priority", e.target.value as TaskInput["priority"])
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-status">Status</Label>
            <select
              id="task-status"
              className="field-select"
              value={value.status}
              onChange={(e) =>
                set("status", e.target.value as TaskInput["status"])
              }
            >
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <SchedulingFields value={value.scheduling} onChange={(scheduling)=>set("scheduling",scheduling)} dependencies={tasks.filter((t)=>!t.deletedAt && t.id!==task?.id).map(({id,title})=>({id,title}))}/>
        <div className="space-y-2">
          <Label htmlFor="task-notes">Notes</Label>
          <Textarea
            id="task-notes"
            maxLength={4000}
            placeholder="Links, context, or a small first step…"
            value={value.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : task ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
export function CourseForm({
  course,
  busy,
  onSave,
  onCancel,
}: FormProps<CourseInput> & { course?: Course }) {
  const [value, setValue] = useState<CourseInput>(() =>
    course
      ? courseInput(course)
      : {
          name: "",
          code: "",
          kind: "course",
          color: "violet",
          description: "",
        },
  );
  const [error, setError] = useState("");
  const set = <K extends keyof CourseInput>(key: K, next: CourseInput[K]) =>
    setValue((previous) => ({ ...previous, [key]: next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      validateCourse(value);
      await onSave(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{course ? "Edit area" : "New area"}</DialogTitle>
        <DialogDescription>
          Course, coding project, or career goal.
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={busy} className="space-y-4">
        <div
          className="grid grid-cols-3 gap-2"
          role="group"
          aria-label="Area type"
        >
          {Object.entries(areaLabels).map(([kind, label]) => {
            const Icon =
              kind === "course"
                ? BookOpen
                : kind === "project"
                  ? Code2
                  : Compass;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={value.kind === kind}
                onClick={() => set("kind", kind as AreaKind)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border px-2 py-3 text-xs transition-colors",
                  value.kind === kind
                    ? "border-primary bg-accent text-primary"
                    : "hover:bg-muted",
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            );
          })}
        </div>
        <div className="space-y-2">
          <Label htmlFor="area-name">Name</Label>
          <Input
            id="area-name"
            autoFocus
            maxLength={200}
            required
            placeholder={
              value.kind === "course"
                ? "e.g. Data Structures & Algorithms"
                : value.kind === "project"
                  ? "e.g. Portfolio website"
                  : "e.g. Software engineering internship"
            }
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="area-code">
            Short label{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="area-code"
            maxLength={30}
            placeholder="e.g. CS 201, SIDE PROJECT, CAREER"
            value={value.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Color</Label>
          <div className="flex gap-3" role="group" aria-label="Area color">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={value.color === color}
                onClick={() => set("color", color)}
                className={cn(
                  "size-8 rounded-full border-4 border-background area-" +
                    color,
                  value.color === color &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                style={{ background: "var(--area-color)" }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="area-description">What are you working toward?</Label>
          <Textarea
            id="area-description"
            maxLength={4000}
            placeholder="A goal, a syllabus note, or a milestone…"
            value={value.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : course ? "Save changes" : "Create area"}
        </Button>
      </DialogFooter>
    </form>
  );
}
