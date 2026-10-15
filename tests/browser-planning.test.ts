import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type CalendarEvent, type Task } from "../lib/domain";
import {
  plan,
  applyProposal,
  undoProposal,
  type PlanOptions,
} from "../lib/planning";
import { previewTransaction, storage } from "../lib/storage";
const task: Task = {
  id: "t",
  title: "Study",
  description: "",
  courseId: null,
  kind: "study",
  status: "todo",
  priority: "high",
  dueDate: "2026-10-15",
  estimateMinutes: 120,
  tagIds: ["tag-learning"],
  createdAt: "old",
  updatedAt: "old",
  deletedAt: null,
};
const o: PlanOptions = {
  startDate: "2026-10-15",
  timeZone: "America/Los_Angeles",
  startHour: 9,
  endHour: 10,
  weekends: false,
  breakMinutes: 10,
};
const now = Date.parse("2026-10-15T08:00:00-07:00");
const busy: CalendarEvent = {
  id: "busy",
  title: "Away",
  description: "",
  start: "2026-10-15T09:00:00-07:00",
  end: "2026-10-15T09:30:00-07:00",
  allDay: false,
  timeZone: o.timeZone,
  tagIds: [],
  taskId: null,
  createdAt: "old",
  updatedAt: "old",
  deletedAt: null,
};
test("browser planner respects fixed events, breaks, deadlines and remaining effort", () => {
  const w = emptyWorkspace();
  w.tasks = [task];
  w.events = [busy];
  const p = plan(w, o, now, "p");
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0].start, "2026-10-15T16:40:00.000Z");
  assert.equal(p.events[0].end, "2026-10-15T17:00:00.000Z");
  assert.equal(p.unscheduled[0].minutes, 100);
  w.events.push({
    ...busy,
    id: "reserved",
    taskId: task.id,
    start: "2026-10-15T12:00:00-07:00",
    end: "2026-10-15T14:00:00-07:00",
  });
  assert.equal(plan(w, o, now, "p").events.length, 0);
  w.events = [
    { ...busy, allDay: true, start: "2026-10-15", end: "2026-10-16" },
  ];
  assert.equal(plan(w, o, now, "p").events.length, 0);
});
test("browser planner uses local dates across spring/fall DST and rejects ambiguous hours", () => {
  const w = emptyWorkspace();
  w.tasks = [{ ...task, estimateMinutes: 180, dueDate: "2026-03-08" }];
  const options = {
    ...o,
    startDate: "2026-03-08",
    startHour: 0,
    endHour: 4,
    weekends: true,
    breakMinutes: 0,
  };
  const spring = plan(
    w,
    options,
    Date.parse("2026-03-07T23:00:00-08:00"),
    "spring",
  );
  assert.equal(spring.unscheduled.length, 0);
  assert.equal(
    spring.events.reduce(
      (n, e) => n + Date.parse(e.end) - Date.parse(e.start),
      0,
    ),
    180 * 60000,
  );
  w.tasks[0].dueDate = "2026-11-01";
  w.tasks[0].estimateMinutes = 300;
  const fall = plan(
    w,
    { ...options, startDate: "2026-11-01" },
    Date.parse("2026-10-31T23:00:00-07:00"),
    "fall",
  );
  assert.equal(fall.unscheduled.length, 0);
  assert.equal(
    fall.events.reduce(
      (n, e) => n + Date.parse(e.end) - Date.parse(e.start),
      0,
    ),
    300 * 60000,
  );
  const ambiguous = plan(
    w,
    { ...options, startDate: "2026-11-01", startHour: 1 },
    Date.parse("2026-10-31T23:00:00-07:00"),
    "ambiguous",
  );
  assert.equal(ambiguous.events.length, 0);
  w.events = [
    { ...busy, allDay: true, start: "2026-11-01", end: "2026-11-02" },
  ];
  assert.equal(
    plan(
      w,
      { ...options, startDate: "2026-11-01" },
      Date.parse("2026-10-31T23:00:00-07:00"),
      "away",
    ).events.length,
    0,
  );
});
test("browser planning preserves priority, split limits, input, and refuses invalid study hours", () => {
  const w = emptyWorkspace();
  w.tasks = [
    { ...task, id: "low", priority: "low", estimateMinutes: 200 },
    { ...task, id: "high" },
  ];
  const before = structuredClone(w);
  const p = plan(w, { ...o, endHour: 17 }, now, "p");
  assert.equal(p.events[0].taskId, "high");
  assert.deepEqual(w, before);
  assert.ok(
    p.events.every(
      (e) => (Date.parse(e.end) - Date.parse(e.start)) / 60000 <= 90,
    ),
  );
  assert.throws(() => plan(w, { ...o, endHour: 24 }, now, "p"));
  assert.throws(() => plan(w, { ...o, startDate: "2026-10-14" }, now, "p"));
});
test("browser plan apply and history are atomic; stale preview and edited undo preserve data", async () => {
  await previewTransaction((w) => {
    w.tasks = [task];
  });
  const before = await storage().load();
  const p = plan(before, o, now, "p");
  const applied = await previewTransaction((w, metadata) => {
    metadata.lastPlan = applyProposal(w, p, new Date(now).toISOString());
  });
  assert.equal(applied.events.length, 1);
  await assert.rejects(
    previewTransaction((w, metadata) => {
      metadata.lastPlan = applyProposal(w, p, new Date(now).toISOString());
    }),
    /changed/,
  );
  assert.deepEqual(await storage().load(), applied);
  // An edit in the same clock tick must also prevent undo.
  await previewTransaction((w) => {
    w.events[0].title = "Same-tick edit";
  });
  await assert.rejects(
    previewTransaction((w, metadata) =>
      undoProposal(w, metadata.lastPlan ?? [], "later"),
    ),
    /edited or removed/,
  );
  await previewTransaction((w) => {
    w.events[0].title = p.events[0].title;
  });
  // Simulate an event edit in a second tab. Undo cannot discard it.
  await previewTransaction((w) => {
    w.events[0].updatedAt = "edited";
  });
  const edited = await storage().load();
  await assert.rejects(
    previewTransaction((w, metadata) => {
      undoProposal(w, metadata.lastPlan ?? [], "later");
      metadata.lastPlan = [];
    }),
    /edited or removed/,
  );
  assert.deepEqual(await storage().load(), edited);
  await previewTransaction((w) => {
    w.events[0].updatedAt = new Date(now).toISOString();
  });
  const undone = await previewTransaction((w, metadata) => {
    undoProposal(w, metadata.lastPlan ?? [], "later");
    metadata.lastPlan = [];
  });
  assert.equal(undone.events[0].deletedAt, "later");
  assert.equal(undone.tasks[0].deletedAt, null);
  await assert.rejects(
    previewTransaction((w) => {
      w.events = [];
      throw new Error("abort batch");
    }),
    /abort batch/,
  );
  assert.deepEqual(await storage().load(), undone);
});
