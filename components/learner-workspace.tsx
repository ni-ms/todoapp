"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  Code2,
  Compass,
  Database,
  Flag,
  ListTodo,
  Menu,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  WorkspaceNavigation,
  viewLabels,
  type WorkspaceView,
} from "@/components/workspace-navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Metric, TaskRow } from "@/components/workspace-items";
import { TaskForm, CourseForm } from "@/components/workspace-forms";
import { ThemeControl } from "@/components/theme-control";
import {
  areaLabels,
  duration,
  formatDate,
  localDate,
  taskLabels,
  taskInput,
  type Course,
  type Task,
  type Workspace,
} from "@/lib/domain";
import { isDesktop, storage } from "@/lib/storage";
import CalendarView from "@/components/calendar-view";
import { EventForm, type CalendarSelection } from "@/components/event-form";
import { TagManager } from "@/components/tag-manager";
import { TagIcon } from "@/components/tag-icon";
import { WorkspaceSettings } from "@/components/workspace-settings";
import { exportCalendar } from "@/lib/ical";
import type { CalendarEvent } from "@/lib/domain";
import { cn } from "@/lib/utils";

type View = WorkspaceView;
type Editor =
  | { type: "task"; task?: Task }
  | { type: "course"; course?: Course }
  | { type: "event"; event?: CalendarEvent; selection?: CalendarSelection }
  | null;
const areaIcons = { course: BookOpen, project: Code2, career: Compass };
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function LearnerWorkspace({
  initialView = "calendar",
}: {
  initialView?: View;
}) {
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [view, setView] = useState<View>(initialView);
  const [area, setArea] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [category, setCategory] = useState("all");
  const [editor, setEditor] = useState<Editor>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [today, setToday] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const openEditor = useCallback((next: NonNullable<Editor>) => {
    editorTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setMobileMenu(false);
    setEditor(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await storage().load();
      setData(result);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    storage()
      .load()
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const updateDate = () => setToday(localDate());
    updateDate();
    const interval = setInterval(updateDate, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (editor) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest("input,select,textarea,[contenteditable=true]") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === "n" && data && !loading) {
        event.preventDefault();
        openEditor({ type: "task" });
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor, data, loading, openEditor]);

  async function commit(action: () => Promise<Workspace>, message: string) {
    if (mutation.current)
      throw new Error("Wait for the current change to finish.");
    mutation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await action());
      setNotice(message);
    } catch (error) {
      throw new Error(errorMessage(error));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function act(action: () => Promise<Workspace>, message: string) {
    try {
      await commit(action, message);
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  function navigate(next: View, courseId: string | null = null) {
    setView(next);
    setArea(courseId);
    setQuery("");
    setCategory("all");
    setFilter("active");
    setMobileMenu(false);
  }
  const courses = data?.courses.filter((course) => !course.deletedAt) ?? [];
  const tasks = data?.tasks.filter((task) => !task.deletedAt) ?? [];
  const pending = tasks.filter((task) => task.status !== "done");
  const completed = tasks.filter((task) => task.status === "done");
  const dayTasks = tasks.filter(
    (task) => task.status === "doing" || !task.dueDate || task.dueDate <= today,
  );
  const selectedArea = data?.courses.find((course) => course.id === area);
  const trashCount =
    (data?.tasks.filter((task) => task.deletedAt).length ?? 0) +
    (data?.courses.filter((course) => course.deletedAt).length ?? 0) +
    (data?.events.filter((event) => event.deletedAt).length ?? 0);
  const pool =
    view === "today"
      ? dayTasks
      : area
        ? tasks.filter((task) => task.courseId === area)
        : tasks;
  const visible = pool
    .filter(
      (task) =>
        (filter === "all" ||
          (filter === "done"
            ? task.status === "done"
            : task.status !== "done")) &&
        (category === "all" || task.tagIds.includes(category)) &&
        `${task.title} ${task.description} ${data?.courses.find((c) => c.id === task.courseId)?.name ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(a.status === "done") - Number(b.status === "done") ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        { high: 0, medium: 1, low: 2 }[a.priority] -
          { high: 0, medium: 1, low: 2 }[b.priority],
    );
  const upcoming = pending
    .filter((task) => task.dueDate && task.dueDate > today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, 3);
  const dayPending = dayTasks.filter((task) => task.status !== "done");
  const totalEffort = dayPending.reduce(
    (sum, task) => sum + task.estimateMinutes,
    0,
  );
  const progress = tasks.length
    ? Math.round((completed.length / tasks.length) * 100)
    : 0;
  const ready = Boolean(data) && !loading && !loadError;
  const dateLabel = today
    ? new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "Your learning workspace";
  const isTaskView = view === "today" || view === "tasks";

  const navigationProps = {
    view,
    area,
    courses,
    pending,
    todayCount: dayPending.length,
    trashCount,
    ready,
    busy,
    navigate,
    onCreateArea: () => openEditor({ type: "course" }),
    onClose: () => setMobileMenu(false),
  };
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card lg:flex">
        <WorkspaceNavigation {...navigationProps} />
      </aside>
      <Dialog open={mobileMenu} onOpenChange={setMobileMenu}>
        <DialogContent
          className="left-0 top-0 flex h-dvh w-[280px] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-[280px]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Workspace navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate your tasks, courses, and projects.
          </DialogDescription>
          <WorkspaceNavigation {...navigationProps} />
        </DialogContent>
      </Dialog>
      <div className="min-w-0">
        <header className="flex h-[76px] items-center justify-between gap-4 border-b bg-card/60 px-5 sm:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              className="lg:hidden"
              size="icon"
              variant="ghost"
              aria-label="Open navigation"
              onClick={() => setMobileMenu(true)}
            >
              <Menu />
            </Button>
            <span className="truncate text-xs font-medium">
              {selectedArea?.name ?? viewLabels[view]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isTaskView && (
              <div className="relative hidden w-52 sm:block">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  ref={search}
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  className="h-8 border-transparent bg-muted/70 pl-9 pr-10 text-xs shadow-none"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd className="pointer-events-none absolute right-2 top-2 text-[10px] text-muted-foreground">
                  ⌘ K
                </kbd>
              </div>
            )}
            <ThemeControl />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto max-w-[1500px] px-5 py-7 sm:px-9 sm:py-9"
        >
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">{dateLabel}</p>
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-1px] sm:text-[32px]">
                {view === "today"
                  ? "My day"
                  : (selectedArea?.name ?? viewLabels[view])}
              </h1>
            </div>
            <div
              className={cn(
                "flex items-center gap-2",
                ["calendar", "tags", "settings"].includes(view) && "hidden",
              )}
            >
              {selectedArea ? (
                <Button
                  variant="outline"
                  disabled={!ready || busy}
                  onClick={() =>
                    openEditor({ type: "course", course: selectedArea })
                  }
                >
                  <Pencil />
                  Edit area
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={!ready || busy}
                  onClick={() => openEditor({ type: "course" })}
                >
                  <Plus />
                  New area
                </Button>
              )}
              <Button
                disabled={!ready || busy}
                onClick={() => openEditor({ type: "task" })}
              >
                <Plus />
                New task
                <span className="ml-2 hidden rounded border border-primary-foreground/25 px-1 text-[10px] opacity-70 sm:inline">
                  N
                </span>
              </Button>
            </div>
          </div>
          {notice && (
            <div
              role="status"
              className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <Check className="size-4 text-emerald-600" />
                {notice}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X />
              </Button>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {loading ? (
            <div aria-label="Loading workspace" className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
              <Skeleton className="h-72" />
            </div>
          ) : loadError ? (
            <div role="alert" className="surface p-8">
              <Database className="mb-3 text-destructive" />
              <h2 className="font-semibold">
                Your workspace couldn’t be opened
              </h2>
              <p className="my-3 text-sm text-muted-foreground">{loadError}</p>
              <Button onClick={refresh}>Try again</Button>
            </div>
          ) : (
            <>
              {view === "today" && (
                <div className="mb-7 grid gap-4 sm:grid-cols-3">
                  <Metric
                    icon={ListTodo}
                    label="ON YOUR RADAR"
                    value={String(dayPending.length)}
                    detail="Due, in progress, or without a date"
                  />
                  <Metric
                    icon={Clock3}
                    label="ESTIMATED EFFORT"
                    value={duration(totalEffort)}
                    detail="For the tasks on your radar"
                  />
                  <Metric
                    icon={CheckCheck}
                    label="SMALL WINS"
                    value={String(completed.length)}
                    detail={`Completed across ${courses.length} active areas`}
                  />
                </div>
              )}
              {isTaskView && (
                <div
                  className={cn(
                    "grid items-start gap-6",
                    view === "today" && "xl:grid-cols-[minmax(0,1fr)_290px]",
                  )}
                >
                  <section
                    className="surface overflow-hidden"
                    aria-labelledby="task-list-heading"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                      <div className="flex items-center gap-2">
                        <h2
                          id="task-list-heading"
                          className="text-sm font-semibold"
                        >
                          {view === "today"
                            ? "Your focus list"
                            : selectedArea
                              ? "Tasks in this area"
                              : "Your tasks"}
                        </h2>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {visible.length}
                        </span>
                      </div>
                      <select
                        className="rounded-md border bg-card px-2 py-1 text-xs outline-none"
                        aria-label="Task status filter"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="active">Active tasks</option>
                        <option value="all">All statuses</option>
                        <option value="done">Completed</option>
                      </select>
                    </div>
                    <div
                      className="flex flex-wrap gap-1 border-b px-4 py-3"
                      role="group"
                      aria-label="Tag filter"
                    >
                      {[
                        { id: "all", name: "All tags", icon: "hash" },
                        ...(data?.tags.filter((t) => !t.deletedAt) ?? []),
                      ].map((tag) => (
                        <button
                          key={tag.id}
                          aria-pressed={category === tag.id}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
                            category === tag.id
                              ? "bg-accent font-medium text-primary"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                          onClick={() => setCategory(tag.id)}
                        >
                          {tag.id !== "all" && (
                            <TagIcon icon={tag.icon} className="size-3" />
                          )}
                          {tag.name}
                        </button>
                      ))}
                    </div>
                    <div className="px-4 py-3 sm:hidden">
                      <Input
                        aria-label="Search tasks on mobile"
                        placeholder="Search tasks…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    {visible.length ? (
                      <ul className="divide-y">
                        {visible.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            tags={data?.tags ?? []}
                            course={data?.courses.find(
                              (c) => c.id === task.courseId,
                            )}
                            today={today}
                            busy={busy}
                            onEdit={() => openEditor({ type: "task", task })}
                            onComplete={() =>
                              act(
                                () =>
                                  storage().saveTask({
                                    ...taskInput(task),
                                    status:
                                      task.status === "done" ? "todo" : "done",
                                  }),
                                task.status === "done"
                                  ? "Task reopened."
                                  : "Task completed.",
                              )
                            }
                            onTrash={() =>
                              act(
                                () =>
                                  storage().setDeleted("task", task.id, true),
                                "Task moved to Trash. You can restore it anytime.",
                              )
                            }
                          />
                        ))}
                      </ul>
                    ) : (
                      <div className="flex flex-col items-center px-6 py-14 text-center">
                        <span className="mb-4 rounded-2xl bg-accent p-3 text-primary">
                          <Sparkles className="size-6" />
                        </span>
                        <h3 className="font-medium">
                          {query || category !== "all" || filter === "done"
                            ? "No tasks match this view"
                            : view === "today" && tasks.length
                              ? "No tasks due"
                              : "No tasks yet"}
                        </h3>
                        <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
                          {query || category !== "all" || filter === "done"
                            ? "Try another filter, or clear your search."
                            : view === "today" && tasks.length
                              ? "No active tasks are due or in progress. Explore all tasks to see what’s ahead."
                              : "Add a task to get started."}
                        </p>
                        <Button
                          className="mt-5"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            query || category !== "all" || filter === "done"
                              ? (setQuery(""),
                                setCategory("all"),
                                setFilter("active"))
                              : view === "today" && tasks.length
                                ? navigate("tasks")
                                : openEditor({ type: "task" })
                          }
                        >
                          {query || category !== "all" || filter === "done"
                            ? "Reset filters"
                            : view === "today" && tasks.length
                              ? "See all tasks"
                              : "Add your first task"}
                          <ArrowRight />
                        </Button>
                      </div>
                    )}
                    <button
                      className="flex w-full items-center gap-2 border-t px-6 py-4 text-xs text-muted-foreground hover:bg-muted/40 hover:text-primary disabled:opacity-50"
                      disabled={busy}
                      onClick={() => openEditor({ type: "task" })}
                    >
                      <Plus className="size-3.5" />
                      Add a task
                      <span className="ml-auto text-[10px]"></span>
                    </button>
                  </section>
                  {view === "today" && (
                    <aside
                      className="space-y-5"
                      aria-label="Workspace overview"
                    >
                      <section className="surface p-5">
                        <div className="flex items-center justify-between">
                          <h2 className="text-sm font-semibold">
                            The bigger picture
                          </h2>
                          <Compass className="size-4 text-muted-foreground" />
                        </div>
                        <div className="my-6 flex items-center gap-5">
                          <div
                            className="relative flex size-20 shrink-0 items-center justify-center rounded-full"
                            role="img"
                            aria-label={`${progress}% of tasks completed`}
                            style={{
                              background: `conic-gradient(var(--primary) ${progress}%, var(--muted) 0)`,
                            }}
                          >
                            <div className="absolute inset-[6px] rounded-full bg-card" />
                            <span className="relative text-lg font-semibold tracking-tight">
                              {progress}
                              <span className="text-xs text-muted-foreground">
                                %
                              </span>
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              Task completion
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {completed.length} of {tasks.length} tasks
                              completed.
                              <br />
                            </p>
                          </div>
                        </div>
                        <Separator />
                        <div className="mt-4 space-y-3">
                          {[
                            [
                              BookOpen,
                              "Learning",
                              pending.filter((t) =>
                                ["study", "assignment"].includes(t.kind),
                              ).length,
                            ],
                            [
                              Code2,
                              "Building",
                              pending.filter((t) => t.kind === "coding").length,
                            ],
                            [
                              Compass,
                              "Career",
                              pending.filter((t) => t.kind === "career").length,
                            ],
                          ].map(([Icon, label, count]) => {
                            const Glyph = Icon as typeof BookOpen;
                            return (
                              <div
                                key={String(label)}
                                className="flex items-center gap-2.5 text-xs"
                              >
                                <Glyph className="size-3.5 text-muted-foreground" />
                                <span>{String(label)}</span>
                                <span className="ml-auto text-muted-foreground">
                                  {String(count)} active
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                      <section className="surface p-5">
                        <div className="mb-4 flex items-center justify-between">
                          <h2 className="text-sm font-semibold">Coming up</h2>
                          <CalendarDays className="size-4 text-muted-foreground" />
                        </div>
                        {upcoming.length ? (
                          <div className="space-y-4">
                            {upcoming.map((task) => (
                              <button
                                key={task.id}
                                className="group flex w-full gap-3 text-left"
                                onClick={() =>
                                  openEditor({ type: "task", task })
                                }
                              >
                                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                  <Flag className="size-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium leading-relaxed group-hover:text-primary">
                                    {task.title}
                                  </p>
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {formatDate(task.dueDate!)} ·{" "}
                                    {duration(task.estimateMinutes)}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            No upcoming deadlines.
                          </p>
                        )}
                      </section>{" "}
                    </aside>
                  )}
                </div>
              )}
              {view === "areas" && (
                <section
                  aria-label="Courses and projects"
                  className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3"
                >
                  {courses.map((course) => {
                    const Icon = areaIcons[course.kind];
                    const areaTasks = tasks.filter(
                      (t) => t.courseId === course.id,
                    );
                    const done = areaTasks.filter(
                      (t) => t.status === "done",
                    ).length;
                    const percentage = areaTasks.length
                      ? Math.round((done / areaTasks.length) * 100)
                      : 0;
                    return (
                      <article
                        key={course.id}
                        className={`surface area-${course.color} flex flex-col p-6`}
                      >
                        <div className="mb-5 flex items-start justify-between">
                          <span
                            className="flex size-11 items-center justify-center rounded-xl"
                            style={{
                              background: "var(--area-soft)",
                              color: "var(--area-color)",
                            }}
                          >
                            <Icon className="size-5" />
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-normal"
                          >
                            {areaLabels[course.kind]}
                          </Badge>
                        </div>
                        <p className="eyebrow">
                          {course.code || "YOUR NEXT CHAPTER"}
                        </p>
                        <button
                          className="mt-2 text-left text-lg font-semibold tracking-tight hover:text-primary"
                          onClick={() => navigate("tasks", course.id)}
                        >
                          {course.name}
                        </button>
                        <p className="mb-6 mt-2 line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
                          {course.description ||
                            "Every small step counts. Add a task to get started."}
                        </p>
                        <div className="mt-auto">
                          <div className="mb-2 flex justify-between text-[10px] text-muted-foreground">
                            <span>
                              {done} of {areaTasks.length} tasks complete
                            </span>
                            <span>{percentage}%</span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${percentage}%`,
                                background: "var(--area-color)",
                              }}
                            />
                          </div>
                          <div className="mt-5 flex items-center justify-between">
                            <button
                              className="flex items-center gap-1 text-xs font-medium text-primary"
                              onClick={() => navigate("tasks", course.id)}
                            >
                              View tasks
                              <ArrowRight className="size-3.5" />
                            </button>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Edit ${course.name}`}
                                disabled={busy}
                                onClick={() =>
                                  openEditor({ type: "course", course })
                                }
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${course.name} to Trash`}
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () =>
                                      storage().setDeleted(
                                        "course",
                                        course.id,
                                        true,
                                      ),
                                    "Area moved to Trash. Its tasks are preserved.",
                                  )
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  <button
                    className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/40 p-7 text-center hover:border-primary/50 hover:bg-accent/20 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => openEditor({ type: "course" })}
                  >
                    <span className="rounded-full bg-accent p-3 text-primary">
                      <Plus className="size-5" />
                    </span>
                    <span className="text-sm font-medium">
                      Make space for a new goal
                    </span>
                    <span className="max-w-52 text-xs leading-relaxed text-muted-foreground">
                      Add a course, a coding project, or your next career
                      milestone.
                    </span>
                  </button>
                </section>
              )}
              {view === "trash" && (
                <section
                  className="surface divide-y"
                  aria-label="Recoverable items"
                >
                  {!trashCount && (
                    <div className="px-6 py-16 text-center">
                      <Trash2 className="mx-auto mb-4 size-7 text-muted-foreground" />
                      <h2 className="text-sm font-medium">Nothing in Trash</h2>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Removed tasks and areas can be restored from here.
                      </p>
                    </div>
                  )}
                  {data?.courses
                    .filter((c) => c.deletedAt)
                    .map((course) => (
                      <div
                        key={course.id}
                        className="flex items-center justify-between gap-4 px-6 py-4"
                      >
                        <div>
                          <p className="text-sm font-medium">{course.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {areaLabels[course.kind]} · Tasks and assignments
                            preserved
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                storage().setDeleted(
                                  "course",
                                  course.id,
                                  false,
                                ),
                              "Area restored.",
                            )
                          }
                        >
                          <RotateCcw />
                          Restore<span className="sr-only"> {course.name}</span>
                        </Button>
                      </div>
                    ))}
                  {data?.tasks
                    .filter((t) => t.deletedAt)
                    .map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between gap-4 px-6 py-4"
                      >
                        <div>
                          <p className="text-sm font-medium">{task.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {taskLabels[task.kind]} ·{" "}
                            {duration(task.estimateMinutes)}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                storage().setDeleted("task", task.id, false),
                              "Task restored.",
                            )
                          }
                        >
                          <RotateCcw />
                          Restore<span className="sr-only"> {task.title}</span>
                        </Button>
                      </div>
                    ))}
                  {data?.events
                    .filter((event) => event.deletedAt)
                    .map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between gap-4 px-6 py-4"
                      >
                        <div>
                          <p className="text-sm font-medium">{event.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Calendar event
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                storage().setDeleted("event", event.id, false),
                              "Event restored.",
                            )
                          }
                        >
                          <RotateCcw />
                          Restore<span className="sr-only"> {event.title}</span>
                        </Button>
                      </div>
                    ))}
                </section>
              )}
              {view === "settings" && data && (
                <WorkspaceSettings
                  workspace={data}
                  onNotice={setNotice}
                  onError={setError}
                  onExample={setData}
                />
              )}
              {view === "calendar" && data && (
                <CalendarView
                  workspace={data}
                  busy={busy}
                  onNew={(selection) =>
                    openEditor({ type: "event", selection })
                  }
                  onEdit={(event) => openEditor({ type: "event", event })}
                  onTask={(id) => {
                    const task = data.tasks.find((t) => t.id === id);
                    if (task) openEditor({ type: "task", task });
                  }}
                  onMove={async (input) => {
                    try {
                      await commit(
                        () => storage().saveEvent(input),
                        "Event rescheduled.",
                      );
                    } catch (error) {
                      setError(errorMessage(error));
                      throw error;
                    }
                  }}
                  onExport={async () => {
                    try {
                      await exportCalendar(data);
                      setNotice(
                        isDesktop()
                          ? "Calendar saved to Downloads."
                          : "Calendar exported.",
                      );
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                />
              )}
              {view === "tags" && data && (
                <TagManager
                  onDelete={(id) =>
                    commit(() => storage().deleteTag(id), "Tag deleted.")
                  }
                  tags={data.tags}
                  busy={busy}
                  onSave={(input) =>
                    commit(() => storage().saveTag(input), "Tag saved.")
                  }
                  onArchive={(id) =>
                    act(
                      () => storage().setDeleted("tag", id, true),
                      "Tag archived.",
                    )
                  }
                  onRestore={(id) =>
                    act(
                      () => storage().setDeleted("tag", id, false),
                      "Tag restored.",
                    )
                  }
                />
              )}
            </>
          )}
        </main>
      </div>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-[540px]"
          showCloseButton={!busy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (editorTrigger.current?.isConnected)
              editorTrigger.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          {editor?.type === "task" && (
            <TaskForm
              key={editor.task?.id ?? "new-task"}
              task={editor.task}
              defaultCourse={area ?? undefined}
              courses={data?.courses ?? []}
              tags={data?.tags ?? []}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={async (input) => {
                await commit(
                  () => storage().saveTask(input),
                  input.id ? "Task updated." : "Task added.",
                );
                setEditor(null);
              }}
            />
          )}
          {editor?.type === "event" && (
            <EventForm
              key={
                editor.event?.id ??
                JSON.stringify(editor.selection) ??
                "new-event"
              }
              event={editor.event}
              selection={editor.selection}
              tags={data?.tags ?? []}
              tasks={data?.tasks ?? []}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={async (input) => {
                await commit(() => storage().saveEvent(input), "Event saved.");
                setEditor(null);
              }}
              onDelete={async () => {
                if (editor.event)
                  await commit(
                    () => storage().setDeleted("event", editor.event!.id, true),
                    "Event moved to Trash.",
                  );
                setEditor(null);
              }}
            />
          )}
          {editor?.type === "course" && (
            <CourseForm
              key={editor.course?.id ?? "new-course"}
              course={editor.course}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={async (input) => {
                await commit(
                  () => storage().saveCourse(input),
                  input.id ? "Area updated." : "Area created.",
                );
                setEditor(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
