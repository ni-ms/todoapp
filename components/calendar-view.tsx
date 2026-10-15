"use client";
import { useMemo, useState } from "react";
import FullCalendar, {
  useCalendarController,
  type EventDropInfo,
  type EventResizeDoneInfo,
} from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/classic";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TagIcon } from "@/components/tag-icon";
import {
  type Workspace,
  type CalendarEvent,
  type EventInput,
  eventInput,
} from "@/lib/domain";
import type { CalendarSelection } from "@/components/event-form";
const plugins = [themePlugin, timeGridPlugin, dayGridPlugin, interactionPlugin];
const palette = {
  violet: "#8065d5",
  blue: "#4888ce",
  emerald: "#32957c",
  amber: "#bf8424",
  rose: "#c66384",
};
export default function CalendarView({
  workspace,
  busy,
  onNew,
  onEdit,
  onTask,
  onMove,
  onExport,
}: {
  workspace: Workspace;
  busy: boolean;
  onNew: (selection?: CalendarSelection) => void;
  onEdit: (event: CalendarEvent) => void;
  onTask: (id: string) => void;
  onMove: (input: EventInput) => Promise<void>;
  onExport: () => void;
}) {
  const controller = useCalendarController();
  const [mode, setMode] = useState("timeGridWeek"),
    [tag, setTag] = useState("all");
  const events = useMemo(
    () => [
      ...workspace.events
        .filter(
          (e) => !e.deletedAt && (tag === "all" || e.tagIds.includes(tag)),
        )
        .map((e) => {
          const t = workspace.tags.find(
            (t) => e.tagIds.includes(t.id) && !t.deletedAt,
          );
          return {
            ...e,
            color: palette[t?.color ?? "violet"],
            contrastColor: "#fff",
            extendedProps: { recordId: e.id },
            className: "daymark-event",
          };
        }),
      ...workspace.tasks
        .filter(
          (t) =>
            !t.deletedAt &&
            t.status !== "done" &&
            t.dueDate &&
            (tag === "all" || t.tagIds.includes(tag)),
        )
        .map((t) => ({
          id: "deadline-" + t.id,
          title: "Due: " + t.title,
          start: t.dueDate!,
          allDay: true,
          editable: false,
          color: "var(--accent)",
          contrastColor: "var(--foreground)",
          className: "daymark-deadline",
          extendedProps: { taskId: t.id },
        })),
    ],
    [workspace, tag],
  );
  async function move(info: EventDropInfo | EventResizeDoneInfo) {
    const original = workspace.events.find((e) => e.id === info.event.id);
    if (!original || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }
    try {
      await onMove({
        ...eventInput(original),
        start: info.event.allDay
          ? info.event.startStr.slice(0, 10)
          : info.event.start.toISOString(),
        end: info.event.allDay
          ? info.event.endStr.slice(0, 10)
          : info.event.end.toISOString(),
        allDay: info.event.allDay,
      });
    } catch {
      info.revert();
    }
  }
  return (
    <section
      className="calendar-shell surface overflow-hidden"
      aria-label="Calendar"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-4">
        <Button variant="outline" size="sm" onClick={() => controller.today()}>
          Today
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Previous period"
          onClick={() => controller.prev()}
        >
          <ChevronLeft />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Next period"
          onClick={() => controller.next()}
        >
          <ChevronRight />
        </Button>
        <h2 className="min-w-32 flex-1 text-base font-semibold tracking-tight">
          {controller.view?.title ?? "Calendar"}
        </h2>
        <select
          aria-label="Calendar tag filter"
          className="h-8 max-w-36 rounded-md border bg-card px-2 text-xs"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="all">All tags</option>
          {workspace.tags
            .filter((t) => !t.deletedAt)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Calendar view"
          className="h-8 rounded-md border bg-card px-3 text-xs"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            controller.changeView(e.target.value);
          }}
        >
          <option value="timeGridWeek">Week</option>
          <option value="dayGridMonth">Month</option>
          <option value="timeGridDay">Day</option>
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Export calendar"
          onClick={onExport}
        >
          <Download />
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onNew()}>
          <Plus />
          Event
        </Button>
      </div>
      <div className="overflow-x-auto">
        <div
          className={mode === "timeGridDay" ? "min-w-[320px]" : "min-w-[700px]"}
        >
          <FullCalendar
            controller={controller}
            plugins={plugins}
            initialView="timeGridWeek"
            headerToolbar={false}
            height="max(600px, calc(100dvh - 260px))"
            events={events}
            firstDay={1}
            nowIndicator
            selectable={!busy}
            editable={!busy}
            selectMirror
            dayMaxEvents={3}
            scrollTime="08:00:00"
            allDayText="All day"
            slotDuration="00:30:00"
            eventMinHeight={24}
            slotLaneClass="calendar-slot"
            dayHeaderClass="calendar-day-header"
            allDayDividerClass="calendar-all-day-divider"
            select={(info) => {
              onNew({
                start: info.allDay
                  ? info.startStr.slice(0, 10)
                  : info.start.toISOString(),
                end: info.allDay
                  ? info.endStr.slice(0, 10)
                  : info.end.toISOString(),
                allDay: info.allDay,
              });
            }}
            dateClick={(info) => {
              if (info.allDay) return;
              onNew({
                start: info.date.toISOString(),
                end: new Date(info.date.getTime() + 3600000).toISOString(),
                allDay: false,
              });
            }}
            eventClick={(info) => {
              if (info.event.extendedProps.taskId) {
                onTask(String(info.event.extendedProps.taskId));
                return;
              }
              const event = workspace.events.find(
                (e) => e.id === info.event.id,
              );
              if (event) onEdit(event);
            }}
            eventDrop={move}
            eventResize={move}
            eventContent={(info) => (
              <div className="flex min-w-0 items-start gap-1 overflow-hidden px-1 py-0.5">
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-medium">
                    {info.timeText}
                  </span>
                  <span className={info.event.allDay?"block truncate text-xs leading-snug":"block text-xs leading-snug"}>
                    {info.event.title}
                  </span>
                </span>
              </div>
            )}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-t px-4 py-2.5">
        {workspace.tags
          .filter((t) => !t.deletedAt)
          .map((t) => (
            <button
              key={t.id}
              aria-pressed={tag === t.id}
              className={`area-${t.color} flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground`}
              onClick={() => setTag(tag === t.id ? "all" : t.id)}
            >
              <span style={{ color: "var(--area-color)" }}>
                <TagIcon icon={t.icon} className="size-3" />
              </span>
              {t.name}
            </button>
          ))}
      </div>
    </section>
  );
}
