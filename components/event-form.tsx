"use client";
import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
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
import { TagPicker } from "@/components/tag-manager";
import {
  localDate,
  validateEvent,
  type CalendarEvent,
  type EventInput,
  type Tag,
  type Task,
} from "@/lib/domain";
import { addDays } from "@/lib/ical";
export interface CalendarSelection {
  start: string;
  end: string;
  allDay: boolean;
}
function localTime(instant: string) {
  const d = new Date(instant);
  return `${localDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function EventForm({
  event,
  selection,
  tags,
  tasks,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  event?: CalendarEvent;
  selection?: CalendarSelection;
  tags: Tag[];
  tasks: Task[];
  busy: boolean;
  onSave: (input: EventInput) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [allDay, setAllDay] = useState(
    event?.allDay ?? selection?.allDay ?? false,
  );
  const [title, setTitle] = useState(event?.title ?? ""),
    [description, setDescription] = useState(event?.description ?? "");
  const [start, setStart] = useState(() => {
    const raw =
      event?.start ??
      selection?.start ??
      new Date(new Date().setMinutes(0, 0, 0)).toISOString();
    return allDay ? raw.slice(0, 10) : localTime(raw);
  });
  const [end, setEnd] = useState(() => {
    const raw =
      event?.end ??
      selection?.end ??
      new Date(
        new Date(new Date().setMinutes(0, 0, 0)).getTime() + 3600000,
      ).toISOString();
    return allDay ? addDays(raw.slice(0, 10), -1) : localTime(raw);
  });
  const [tagIds, setTags] = useState(event?.tagIds ?? []),
    [taskId, setTask] = useState<string | null>(event?.taskId ?? null),
    [error, setError] = useState("");
  function toggle(checked: boolean) {
    if (checked) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      setStart(start.slice(0, 10) + "T09:00");
      setEnd(end.slice(0, 10) + "T10:00");
    }
    setAllDay(checked);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!allDay) {
        for (const value of [start, end])
          if (localTime(new Date(value).toISOString()) !== value)
            throw new Error(
              "This time does not exist due to daylight saving. Choose another time.",
            );
      }
      const input: EventInput = {
        id: event?.id,
        title,
        description,
        start: allDay ? start : new Date(start).toISOString(),
        end: allDay ? addDays(end, 1) : new Date(end).toISOString(),
        allDay,
        timeZone: zone,
        tagIds,
        taskId,
      };
      validateEvent(input);
      await onSave(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <form className="space-y-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription className="sr-only">
          Set the event dates, times, and tags.
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={busy} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="event-title">Title</Label>
          <Input
            id="event-title"
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a title"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-task">
            Link a task{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <select
            id="event-task"
            className="field-select"
            value={taskId ?? ""}
            onChange={(e) => {
              const task = tasks.find((t) => t.id === e.target.value);
              setTask(task?.id ?? null);
              if (task) {
                setTitle(task.title);
                setTags(
                  task.tagIds.filter((id) =>
                    tags.some((t) => t.id === id && !t.deletedAt),
                  ),
                );
                if (!allDay && Number.isFinite(Date.parse(start)))
                  setEnd(
                    localTime(
                      new Date(
                        new Date(start).getTime() +
                          task.estimateMinutes * 60000,
                      ).toISOString(),
                    ),
                  );
              }
            }}
          >
            <option value="">No linked task</option>
            {tasks
              .filter((t) => !t.deletedAt || t.id === taskId)
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => toggle(e.target.checked)}
            className="size-4 accent-primary"
          />
          All day
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-start">Starts</Label>
            <Input
              id="event-start"
              required
              type={allDay ? "date" : "datetime-local"}
              value={start}
              onInput={(e) => setStart(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end">Ends</Label>
            <Input
              id="event-end"
              required
              type={allDay ? "date" : "datetime-local"}
              value={end}
              onInput={(e) => setEnd(e.currentTarget.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {zone.replaceAll("_", " ")}
        </p>
        <div className="space-y-2">
          <Label>Tags</Label>
          <TagPicker tags={tags} value={tagIds} onChange={setTags} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-notes">Notes</Label>
          <Textarea
            id="event-notes"
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        {event && (
          <Button
            type="button"
            className="sm:mr-auto"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              try {
                await onDelete();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <Trash2 />
            Move to Trash
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save event"}
        </Button>
      </DialogFooter>
    </form>
  );
}
