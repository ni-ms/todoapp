"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Database,
  Menu,
  Plus,
  Search,
  X,
  CalendarDays,
} from "lucide-react";
import {
  WorkspaceNavigation,
  viewLabels,
  type WorkspaceView,
} from "@/components/workspace-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskRow } from "@/components/workspace-items";
import { TaskForm } from "@/components/workspace-forms";
import { ThemeControl } from "@/components/theme-control";
import { WorkspaceSettings } from "@/components/workspace-settings";
import CalendarView from "@/components/calendar-view";
import { EventForm, type CalendarSelection } from "@/components/event-form";
import { TagManager } from "@/components/tag-manager";
import { TrashView } from "@/components/trash-view";
import { TaskCapture } from "@/components/task-capture";
import { AreaManager } from "@/components/area-manager";
import { areaTagIds, taskInArea, eventInArea } from "@/lib/areas";
import { BrowserServices } from "./browser-services";
import { Planner } from "@/components/planner";
import { storage, isDesktop } from "@/lib/storage";
import { exportCalendar } from "@/lib/ical";
import {
  localDate,
  taskInput,
  type Workspace,
  type Task,
  type CalendarEvent,
} from "@/lib/domain";
type Editor =
  | { type: "task"; task?: Task }
  | { type: "event"; event?: CalendarEvent; selection?: CalendarSelection }
  | null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function LearnerWorkspace({
  initialView = "calendar",
}: {
  initialView?: WorkspaceView;
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState(initialView),
    [tag, setTag] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("active"),
    [editor, setEditor] = useState<Editor>(null),
    [mobileMenu, setMobileMenu] = useState(false),
    [today, setToday] = useState("");
  const mutation = useRef(false),
    search = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const openEditor = useCallback((next: NonNullable<Editor>) => {
    trigger.current =
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
      setData(await storage().load());
    } catch (e) {
      setLoadError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    storage()
      .load()
      .then((w) => {
        if (active) setData(w);
      })
      .catch((e) => {
        if (active) setLoadError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const tick = () => setToday(localDate());
    tick();
    const timer = setInterval(tick, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editor) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (search.current) {
          event.preventDefault();
          search.current.focus();
        }
        return;
      }
      if (
        (event.target as HTMLElement).closest(
          "input,select,textarea,[contenteditable=true]",
        ) ||
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, editor, loading, openEditor]);
  async function commit(action: () => Promise<Workspace>, notice: string) {
    if (mutation.current)
      throw new Error("Wait for the current change to finish.");
    mutation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await action());
      setNotice(notice);
    } catch (e) {
      throw new Error(message(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function act(action: () => Promise<Workspace>, notice: string) {
    try {
      await commit(action, notice);
    } catch (e) {
      setError(message(e));
    }
  }
  function navigate(next: WorkspaceView, tagId: string | null = null) {
    setView(next);
    setTag(tagId);
    setQuery("");
    setFilter("active");
    setMobileMenu(false);
  }
  const tasks = data?.tasks.filter((t) => !t.deletedAt) ?? [],
    pending = tasks.filter((t) => t.status !== "done"),
    tags = data?.tags ?? [],
    areas = data?.areas ?? [],
    activeArea = areas.find((a) => a.id === tag && !a.deletedAt);
  const selectedTags = activeArea ? areaTagIds(activeArea, tags) : null;
  const defaultTag = selectedTags?.[0];
  const dayEvents =
    data?.events
      .filter(
        (e) =>
          !e.deletedAt &&
          (e.allDay
            ? e.start <= today && e.end > today
            : localDate(new Date(e.start)) === today ||
              (new Date(e.start) < new Date(today + "T00:00:00") &&
                new Date(e.end) > new Date(today + "T00:00:00"))),
      )
      .sort((a, b) => a.start.localeCompare(b.start)) ?? [];
  const areaEvents = dayEvents.filter((event) => eventInArea(event, selectedTags, tasks));
  const areaPending = pending.filter((task) => taskInArea(task, selectedTags));
  const dayIds = new Set(dayEvents.map((e) => e.taskId));
  const dayTasks = pending.filter(
    (t) =>
      t.status === "doing" ||
      (!!t.dueDate && t.dueDate <= today) ||
      dayIds.has(t.id),
  );
  const pool = view === "today" ? dayTasks : tasks;
  const visible = pool
    .filter(
      (t) =>
        taskInArea(t, selectedTags) &&
        (filter === "all" ||
          (filter === "done" ? t.status === "done" : t.status !== "done")) &&
        `${t.title} ${t.description} ${tags
          .filter((tag) => t.tagIds.includes(tag.id))
          .map((t) => t.name)
          .join(" ")}`
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
  const trashCount = data
    ? [...data.tasks, ...data.courses, ...data.events, ...data.tags, ...data.areas].filter(
        (r) => r.deletedAt,
      ).length
    : 0;
  const isTaskView = view === "today" || view === "tasks",
    ready = !!data && !loading && !loadError;
  const navigation = {
    view,
    area: activeArea?.id ?? null,
    tags,
    areas,
    pending,
    todayCount: dayTasks.length,
    trashCount,
    ready,
    busy,
    navigate,
    onClose: () => setMobileMenu(false),
  };
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <BrowserServices />
      <a
        href="#main"
        className="sr-only z-50 rounded bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card lg:flex">
        <WorkspaceNavigation {...navigation} />
      </aside>
      <Dialog open={mobileMenu} onOpenChange={setMobileMenu}>
        <DialogContent
          className="left-0 top-0 flex h-dvh w-[280px] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-[280px]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a page or area.
          </DialogDescription>
          <WorkspaceNavigation {...navigation} />
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
              {view === "tasks" && activeArea ? activeArea.name : viewLabels[view]}
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
                  className="h-8 bg-muted/70 pl-9 text-xs"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            <ThemeControl />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto max-w-[1500px] px-5 py-7 sm:px-9 sm:py-9"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                {today
                  ? new Date(today + "T12:00:00").toLocaleDateString(
                      undefined,
                      { weekday: "long", month: "long", day: "numeric" },
                    )
                  : ""}
              </p>
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-1px] sm:text-[32px]">
                {view === "tasks" && activeArea ? activeArea.name : viewLabels[view]}
              </h1>
            </div>
            {isTaskView && (
              <div className="flex flex-wrap items-center gap-3">
                {view === "today" && <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Area
                  <select aria-label="My day area" className="h-9 max-w-52 rounded-md border bg-card px-3 text-sm text-foreground" value={activeArea?.id ?? ""} onChange={(e) => setTag(e.target.value || null)} disabled={!ready || busy}>
                    <option value="">All areas</option>
                    {areas.filter((tag) => !tag.deletedAt).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                  </select>
                </label>}
              <Button
                disabled={!ready || busy}
                onClick={() => openEditor({ type: "task" })}
              >
                <Plus />
                New task
              </Button>
              </div>
            )}
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
            <Skeleton className="h-72" />
          ) : loadError ? (
            <section role="alert" className="surface p-8">
              <Database className="mb-3 text-destructive" />
              <h2 className="font-semibold">Your planner couldn’t be opened</h2>
              <p className="my-3 text-sm text-muted-foreground">{loadError}</p>
              <Button onClick={refresh}>Try again</Button>
            </section>
          ) : (
            data && (
              <>
                {view === "today" && (
                  <>
                    <TaskCapture
                      tags={tags}
                      defaultTag={defaultTag}
                      onSettings={() => navigate("settings")}
                      onSave={(inputs) =>
                        commit(
                          () => storage().saveTasks(inputs),
                          "Tasks added.",
                        )
                      }
                    />
                    <Planner
                      onApply={(w, notice) => {
                        setData(w);
                        setNotice(notice);
                      }}
                    />
                  </>
                )}
                {isTaskView && (
                  <div
                    className={
                      view === "today"
                        ? "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"
                        : ""
                    }
                  >
                    <section className="surface overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                        <div>
                          <h2 className="text-sm font-semibold">
                            {view === "today"
                              ? "Due & in progress"
                              : activeArea
                                ? `Tasks in ${activeArea.name}`
                                : "Your tasks"}
                          </h2>
                          {view === "today" && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Due today, overdue, in progress, or scheduled
                              today.
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {view === "tasks" && (
                            <select
                              aria-label="Task status filter"
                              className="h-8 rounded-md border bg-card px-2 text-xs"
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                            >
                              <option value="active">Active tasks</option>
                              <option value="all">All tasks</option>
                              <option value="done">Completed</option>
                            </select>
                          )}
                          {view === "tasks" && <select
                            aria-label="Task area filter"
                            className="h-8 max-w-44 rounded-md border bg-card px-2 text-xs"
                            value={tag ?? ""}
                            onChange={(e) => setTag(e.target.value || null)}
                          >
                            <option value="">All areas</option>
                            {areas
                              .filter((t) => !t.deletedAt)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                          </select>}
                          <Input
                            className="h-8 w-full text-xs sm:hidden"
                            aria-label="Search tasks on mobile"
                            placeholder="Search tasks…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                      </div>
                      {visible.length ? (
                        <ul className="divide-y">
                          {visible.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              tags={tags}
                              today={today}
                              busy={busy}
                              onEdit={() => openEditor({ type: "task", task })}
                              onComplete={() =>
                                act(
                                  () =>
                                    storage().saveTask({
                                      ...taskInput(task),
                                      status:
                                        task.status === "done"
                                          ? "todo"
                                          : "done",
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
                                  "Task moved to Trash.",
                                )
                              }
                            />
                          ))}
                        </ul>
                      ) : (
                        <div className="p-8 text-center">
                          <p className="text-sm text-muted-foreground">
                            {query
                              ? "No tasks match your search."
                              : view === "today"
                                ? "Nothing due or in progress today."
                                : "No tasks here yet."}
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => openEditor({ type: "task" })}
                        >
                          <Plus />
                          Add a task
                        </Button>
                        {view === "today" && (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => navigate("tasks", activeArea?.id ?? null)}
                          >
                            View all {areaPending.length} active tasks
                          </Button>
                        )}
                      </div>
                    </section>
                    {view === "today" && (
                      <section className="surface p-5">
                        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                          <CalendarDays className="size-4" />
                          Today’s schedule
                        </h2>
                        {areaEvents.length ? (
                          <div className="space-y-2">
                            {areaEvents.map((e) => (
                              <button
                                key={e.id}
                                onClick={() =>
                                  openEditor({ type: "event", event: e })
                                }
                                className="flex w-full items-center gap-4 rounded-lg bg-muted/50 px-3 py-3 text-left text-sm"
                              >
                                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                                  {e.allDay
                                    ? "All day"
                                    : new Date(e.start).toLocaleTimeString(
                                        undefined,
                                        { hour: "numeric", minute: "2-digit" },
                                      )}
                                </span>
                                <span className="truncate">{e.title}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No events planned today.
                          </p>
                        )}
                        <Button
                          variant="link"
                          className="mt-2 h-auto px-0 text-xs"
                          onClick={() => navigate("calendar")}
                        >
                          Open calendar
                        </Button>
                      </section>
                    )}
                  </div>
                )}
                {view === "areas" && <AreaManager areas={areas} tags={tags} tasks={tasks} busy={busy} onOpen={(id) => navigate("tasks", id)} onSave={(input) => commit(() => storage().saveArea(input), "Area saved.")} onArchive={(id) => act(() => storage().setDeleted("area", id, true), "Area moved to Trash.")} />}
                {view === "tags" && (
                  <TagManager
                    key={view}
                    tags={tags}
                    busy={busy}
                    onSave={(input) =>
                      commit(() => storage().saveTag(input), "Tag saved.")
                    }
                    onArchive={(id) =>
                      act(
                        () => storage().setDeleted("tag", id, true),
                        "Tag moved to Trash.",
                      )
                    }
                    onRestore={(id) =>
                      act(
                        () => storage().setDeleted("tag", id, false),
                        "Tag restored.",
                      )
                    }
                    onDelete={(id) =>
                      commit(() => storage().deleteTag(id), "Tag deleted.")
                    }
                  />
                )}
                {view === "trash" && (
                  <TrashView
                    workspace={data}
                    busy={busy}
                    onRestore={(entity, id) =>
                      commit(
                        () => storage().setDeleted(entity, id, false),
                        "Item restored.",
                      )
                    }
                    onDelete={(entity, id) =>
                      commit(
                        () => storage().purgeRecord(entity, id),
                        "Item permanently deleted.",
                      )
                    }
                  />
                )}
                {view === "settings" && (
                  <WorkspaceSettings
                    workspace={data}
                    onNotice={setNotice}
                    onError={setError}
                    onExample={setData}
                  />
                )}
                {view === "calendar" && (
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
                        setError(message(error));
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
                        setError(message(e));
                      }
                    }}
                  />
                )}
              </>
            )
          )}
        </main>
      </div>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-[540px]"
          showCloseButton={!busy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          {editor?.type === "task" && (
            <TaskForm
              key={editor.task?.id ?? "new"}
              task={editor.task}
              defaultTag={defaultTag}
              tags={tags}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={async (input) => {
                await commit(() => storage().saveTask(input), "Task saved.");
                setEditor(null);
              }}
            />
          )}
          {editor?.type === "event" && (
            <EventForm
              key={
                editor.event?.id ?? JSON.stringify(editor.selection) ?? "new"
              }
              event={editor.event}
              selection={editor.selection}
              tags={tags}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
