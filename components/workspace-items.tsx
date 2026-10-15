"use client";
import {
  BookOpen,
  GraduationCap,
  Code2,
  Compass,
  Circle,
  ListTodo,
  Clock3,
  CalendarDays,
  Check,
  Flag,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import { TagIcon } from "@/components/tag-icon";
import type { Tag } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  duration,
  formatDate,
  statusLabels,
  taskLabels,
  type Task,
  type Course,
} from "@/lib/domain";
const workIcons = {
  study: BookOpen,
  assignment: GraduationCap,
  coding: Code2,
  career: Compass,
  personal: Circle,
};
export function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof ListTodo;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="surface flex items-start gap-4 p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/65 text-primary">
        <Icon className="size-[18px]" />
      </div>
      <div>
        <p className="eyebrow">{label}</p>
        <p className="mb-1 mt-2 text-[27px] font-semibold leading-none tracking-[-1px] tabular-nums">
          {value}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">{detail}</p>
      </div>
    </section>
  );
}
export function TaskRow({
  task,
  tags,
  course,
  today,
  busy,
  onEdit,
  onComplete,
  onTrash,
}: {
  task: Task;
  tags: Tag[];
  course?: Course;
  today: string;
  busy: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onTrash: () => void;
}) {
  const Icon = workIcons[task.kind];
  const done = task.status === "done";
  const overdue = !done && task.dueDate && task.dueDate < today;
  return (
    <li className="group flex gap-3 px-5 py-5 transition-colors hover:bg-muted/35">
      <button
        aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
        aria-pressed={done}
        disabled={busy}
        onClick={onComplete}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/35 hover:border-primary hover:bg-accent",
        )}
      >
        {done && <Check className="size-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            className={cn(
              "text-left text-[13px] font-medium leading-relaxed hover:text-primary",
              done && "text-muted-foreground line-through",
            )}
            onClick={onEdit}
          >
            {task.title}
          </button>
          {task.status === "doing" && (
            <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[9px] text-primary">
              <LoaderCircle className="size-2.5" />
              In progress
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] text-muted-foreground">
          {course ? (
            <span
              className={`inline-flex items-center gap-1.5 area-${course.color}`}
            >
              <span className="area-dot !size-1.5" />
              {course.code || course.name}
              {course.deletedAt ? " · in Trash" : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Icon className="size-3" />
              {taskLabels[task.kind]}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock3 className="size-3" />
            {duration(task.estimateMinutes)}
          </span>
          {task.dueDate && (
            <span
              className={cn(
                "flex items-center gap-1",
                overdue && "font-medium text-destructive",
              )}
            >
              <CalendarDays className="size-3" />
              {overdue ? "Overdue · " : ""}
              {task.dueDate === today ? "Today" : formatDate(task.dueDate)}
            </span>
          )}
          {task.priority === "high" && !done && (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Flag className="size-3" />
              High priority
            </span>
          )}
          {tags
            .filter((tag) => !tag.deletedAt && task.tagIds.includes(tag.id))
            .map((tag) => (
              <span
                key={tag.id}
                className={`area-${tag.color} inline-flex items-center gap-1.5 rounded px-1.5 py-0.5`}
                style={{
                  background: "var(--area-soft)",
                  color: "var(--area-color)",
                }}
              >
                <TagIcon icon={tag.icon} className="size-3" />
                {tag.name}
              </span>
            ))}
          <span className="sr-only">{statusLabels[task.status]}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-0.5">
        <Button
          className="text-muted-foreground"
          variant="ghost"
          size="icon-xs"
          aria-label={`Edit ${task.title}`}
          onClick={onEdit}
        >
          <Pencil className="size-3" />
        </Button>
        <Button
          className="text-muted-foreground hover:text-destructive"
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${task.title} to Trash`}
          disabled={busy}
          onClick={onTrash}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </li>
  );
}
