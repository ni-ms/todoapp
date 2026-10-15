import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarText, addDays, escapeText } from "../lib/ical";
import {
  emptyWorkspace,
  validateEvent,
  type CalendarEvent,
} from "../lib/domain";
const event: CalendarEvent = {
  id: "event-one",
  title: "Study, code; learn",
  description: "First\nSecond\\Third",
  start: "2026-03-08T09:30:00Z",
  end: "2026-03-08T10:30:00Z",
  allDay: false,
  timeZone: "America/Los_Angeles",
  tagIds: [],
  taskId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};
test("UTC timed export preserves instants across a DST transition", () => {
  const w = emptyWorkspace();
  w.events.push(event);
  const text = calendarText(w);
  assert.ok(
    text.includes("DTSTART:20260308T093000Z\r\nDTEND:20260308T103000Z"),
  );
  assert.ok(text.includes("SUMMARY:Study\\, code\\; learn"));
  assert.ok(text.includes("DESCRIPTION:First\\nSecond\\\\Third"));
  assert.equal(text, calendarText(w));
});
test("all-day end is exclusive and deadlines advance across years", () => {
  const w = emptyWorkspace();
  w.events.push({
    ...event,
    allDay: true,
    start: "2026-10-31",
    end: "2026-11-02",
  });
  w.tasks.push({
    id: "task",
    title: "Deadline",
    description: "",
    courseId: null,
    kind: "study",
    status: "todo",
    priority: "medium",
    dueDate: "2026-12-31",
    estimateMinutes: 30,
    tagIds: [],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deletedAt: null,
  });
  const text = calendarText(w);
  assert.ok(text.includes("DTEND;VALUE=DATE:20261102"));
  assert.ok(text.includes("DTEND;VALUE=DATE:20270101"));
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
});
test("folds long UTF-8 text at 75 octets, using CRLF", () => {
  const w = emptyWorkspace();
  w.events.push({ ...event, title: "é🚀".repeat(30) });
  const text = calendarText(w);
  assert.ok(text.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.ok(text.replace(/\r\n /g, "").includes("SUMMARY:" + "é🚀".repeat(30)));
  assert.ok(!text.replaceAll("\r\n", "").includes("\n"));
});
test("omits deleted events and completed task deadlines", () => {
  const w = emptyWorkspace();
  w.events.push({ ...event, deletedAt: event.updatedAt });
  w.tasks.push({
    id: "completed",
    title: "Finished",
    description: "",
    courseId: null,
    kind: "study",
    status: "done",
    priority: "medium",
    dueDate: "2026-10-15",
    estimateMinutes: 30,
    tagIds: [],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deletedAt: null,
  });
  assert.ok(!calendarText(w).includes("BEGIN:VEVENT"));
});
test("validation rejects impossible ranges, dates and zones", () => {
  assert.throws(() => validateEvent({ ...event, end: event.start }));
  assert.throws(() => validateEvent({ ...event, timeZone: "Mars/Olympus" }));
  assert.throws(() =>
    validateEvent({
      ...event,
      allDay: true,
      start: "2026-02-30",
      end: "2026-03-02",
    }),
  );
  assert.doesNotThrow(() => validateEvent(event));
  assert.equal(escapeText("a\r\nb"), "a\\nb");
});
