"use client";
import type { ComponentType } from "react";
import {
  Sun,
  X,
  LayoutDashboard,
  ListTodo,
  FolderOpen,
  Plus,
  Trash2,
  Settings2,
  CalendarDays,
  Tags,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Course, Task } from "@/lib/domain";
export type WorkspaceView =
  "calendar" | "today" | "tasks" | "areas" | "tags" | "trash" | "settings";
export const viewLabels: Record<WorkspaceView, string> = {
  calendar: "Calendar",
  tags: "Tags",
  today: "My day",
  tasks: "All tasks",
  areas: "Courses & projects",
  trash: "Trash",
  settings: "Settings",
};
interface NavigationProps {
  view: WorkspaceView;
  area: string | null;
  courses: Course[];
  pending: Task[];
  todayCount: number;
  trashCount: number;
  ready: boolean;
  busy: boolean;
  navigate: (view: WorkspaceView, area?: string | null) => void;
  onCreateArea: () => void;
  onClose: () => void;
}
export function WorkspaceNavigation({
  view,
  area,
  courses,
  pending,
  todayCount,
  trashCount,
  ready,
  busy,
  navigate,
  onCreateArea,
  onClose,
}: NavigationProps) {
  const navItem = (
    target: WorkspaceView,
    Icon: ComponentType<{ className?: string }>,
    count?: number,
  ) => (
    <button
      key={target}
      onClick={() => navigate(target)}
      aria-current={view === target && !area ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
        view === target && !area
          ? "bg-accent text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-[17px]" />
      {viewLabels[target]}
      {count !== undefined && (
        <span className="ml-auto text-xs tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
  const sidebar = (
    <>
      <div className="flex items-center gap-2.5 px-7 pb-7 pt-9">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sun className="size-5" strokeWidth={1.8} />
        </span>
        <span className="text-xl font-semibold tracking-[-0.7px]">
          daymark<span className="text-primary">.</span>
        </span>
        <Button
          className="ml-auto lg:hidden"
          variant="ghost"
          size="icon"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <nav aria-label="Workspace navigation" className="space-y-1 px-3">
        {navItem("calendar", CalendarDays)}
        {navItem("today", LayoutDashboard, todayCount)}
        {navItem("tasks", ListTodo, pending.length)}
        {navItem("areas", FolderOpen, courses.length)}
        {navItem("tags", Tags)}
      </nav>
      <div className="mt-7 flex items-center justify-between px-6">
        <p className="eyebrow">Your areas</p>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Add a course or project"
          disabled={!ready || busy}
          onClick={onCreateArea}
        >
          <Plus />
        </Button>
      </div>
      <nav
        aria-label="Courses and projects"
        className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4"
      >
        {courses.map((course) => (
          <button
            key={course.id}
            onClick={() => navigate("tasks", course.id)}
            aria-current={area === course.id ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs hover:bg-muted",
              area === course.id && "bg-muted",
            )}
          >
            <span className={`area-dot area-${course.color}`} />
            <span className="truncate">{course.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {pending.filter((task) => task.courseId === course.id).length}
            </span>
          </button>
        ))}
      </nav>
      <div className="px-3 pb-4">
        {navItem("trash", Trash2, trashCount || undefined)}
        {navItem("settings", Settings2)}
      </div>
    </>
  );
  return sidebar;
}
