"use client";
import {
  Sun,
  X,
  LayoutDashboard,
  ListTodo,
  Plus,
  Trash2,
  Settings2,
  CalendarDays,
  Tags,
  PanelsTopLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TagIcon } from "@/components/tag-icon";
import { cn } from "@/lib/utils";
import { areaTagIds, taskInArea } from "@/lib/areas";
import type { Area, Tag, Task } from "@/lib/domain";
export type WorkspaceView =
  | "calendar"
  | "today"
  | "tasks"
  | "areas"
  | "tags"
  | "trash"
  | "settings";
export const viewLabels: Record<WorkspaceView, string> = {
  calendar: "Calendar",
  today: "My day",
  tasks: "Tasks",
  areas: "Areas",
  tags: "Tags",
  trash: "Trash",
  settings: "Settings",
};
export function WorkspaceNavigation({
  view,
  area,
  tags,
  areas,
  pending,
  todayCount,
  trashCount,
  ready,
  busy,
  navigate,
  onClose,
}: {
  view: WorkspaceView;
  area: string | null;
  tags: Tag[];
  areas: Area[];
  pending: Task[];
  todayCount: number;
  trashCount: number;
  ready: boolean;
  busy: boolean;
  navigate: (view: WorkspaceView, tag?: string | null) => void;
  onClose: () => void;
}) {
  const item = (target: WorkspaceView, Icon: typeof Sun, count?: number) => (
    <button
      key={target}
      aria-current={view === target && (target !== "tasks" || !area) ? "page" : undefined}
      onClick={() => navigate(target)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium",
        view === target && (target !== "tasks" || !area)
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
  return (
    <>
      <div className="flex items-center gap-2.5 px-7 pb-7 pt-9">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sun className="size-5" />
        </span>
        <span className="text-xl font-semibold tracking-tight">
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
      <nav aria-label="Main navigation" className="space-y-1 px-3">
        {item("today", LayoutDashboard, todayCount)}
        {item("calendar", CalendarDays)}
        {item("tasks", ListTodo, pending.length)}
        {item("areas", PanelsTopLeft)}
        {item("tags", Tags)}
      </nav>
      <div className="mt-7 flex items-center justify-between px-6">
        <p className="eyebrow">Your areas</p>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Manage areas"
          disabled={!ready || busy}
          onClick={() => navigate("areas")}
        >
          <Plus />
        </Button>
      </div>
      <nav
        aria-label="Area shortcuts"
        className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4"
      >
        {areas
          .filter((t) => !t.deletedAt)
          .map((tag) => (
            <button
              key={tag.id}
              onClick={() => navigate("tasks", tag.id)}
              aria-current={view === "tasks" && area === tag.id ? "page" : undefined}
              className={cn(
                `area-${tag.color} flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs hover:bg-muted`,
                view === "tasks" && area === tag.id && "bg-muted",
              )}
            >
              <span style={{ color: "var(--area-color)" }}>
                <TagIcon icon={tag.icon} className="size-3.5" />
              </span>
              <span className="truncate">{tag.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {pending.filter((t) => taskInArea(t, areaTagIds(tag, tags))).length}
              </span>
            </button>
          ))}
      </nav>
      <div className="px-3 pb-4">
        {item("trash", Trash2, trashCount || undefined)}
        {item("settings", Settings2)}
      </div>
    </>
  );
}
