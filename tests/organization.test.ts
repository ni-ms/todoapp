import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type Task } from "../lib/domain";
import { unifyTags, purgeFromWorkspace } from "../lib/organization";
import { areaTagIds, taskInArea, eventInArea } from "../lib/areas";
import { pcmWav } from "../lib/audio";
const meta = {
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
  deletedAt: null,
};
const task: Task = {
  ...meta,
  id: "t",
  title: "Study",
  description: "Keep notes",
  courseId: "c",
  kind: "study",
  status: "todo",
  priority: "high",
  estimateMinutes: 30,
  dueDate: null,
  tagIds: ["tag-learning"],
};
test("one tag system preserves course details and assignments, including Trash", () => {
  const w = emptyWorkspace();
  w.courses.push({
    ...meta,
    id: "c",
    name: "Algorithms",
    code: "CS201",
    kind: "course",
    color: "blue",
    description: "Trees",
    deletedAt: meta.createdAt,
  });
  w.tasks.push({ ...task });
  unifyTags(w);
  unifyTags(w);
  assert.equal(w.courses.length, 0);
  assert.equal(w.tags.filter((t) => t.id === "course-c").length, 1);
  assert.equal(w.tags.find((t) => t.id === "course-c")?.description, "Trees");
  assert.deepEqual(w.tasks[0].tagIds, ["tag-learning", "course-c"]);
  assert.equal(w.tasks[0].courseId, null);
});
test("permanent deletion requires Trash and preserves related events", () => {
  const w = emptyWorkspace();
  w.tasks.push({ ...task, courseId: null });
  w.events.push({
    ...meta,
    id: "e",
    title: "Session",
    description: "",
    start: "2026-10-15",
    end: "2026-10-16",
    allDay: true,
    timeZone: "UTC",
    tagIds: ["tag-learning"],
    taskId: "t",
  });
  assert.throws(() => purgeFromWorkspace(w, "task", "t"));
  w.tasks[0].deletedAt = meta.createdAt;
  purgeFromWorkspace(w, "task", "t");
  assert.equal(w.events.length, 1);
  assert.equal(w.events[0].taskId, null);
  w.tags[0].deletedAt = meta.createdAt;
  purgeFromWorkspace(w, "tag", "tag-learning");
  assert.deepEqual(w.events[0].tagIds, []);
});
test("speech conversion creates mono 16 kHz PCM WAV with clamped samples", () => {
  const bytes = pcmWav(new Float32Array([-2, 0, 2]));
  const v = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "RIFF");
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getInt16(44, true), -32768);
  assert.equal(v.getInt16(48, true), 32767);
  assert.equal(v.getUint32(40, true), 6);
});

test("area agenda includes direct tags and linked multi-area tasks without reviving trashed task assignments", () => {
  const event = {
    ...meta, id: "session", title: "Study", description: "", start: "2026-10-15", end: "2026-10-16",
    allDay: true, timeZone: "UTC", tagIds: ["career"], taskId: task.id,
  };
  const linked = { ...task, tagIds: ["learning", "building"] };
  assert.equal(eventInArea(event, null, []), true);
  for (const area of ["learning", "building", "career"]) {
    assert.equal(eventInArea(event, [area], [linked]), true);
  }
  assert.equal(eventInArea(event, ["fitness"], [linked]), false);
  assert.equal(eventInArea(event, ["learning"], [{ ...linked, deletedAt: meta.createdAt }]), false);
  assert.equal(eventInArea({ ...event, taskId: null }, ["learning"], [linked]), false);
});

test("areas have independent names, any-tag membership, and no matches after their tags are archived", () => {
  const w = emptyWorkspace();
  const area = { ...meta, id: "area", name: "Developer journey", icon: "code", color: "blue" as const, tagIds: ["tag-learning", "tag-career"] };
  w.areas.push(area);
  assert.equal(taskInArea(task, areaTagIds(area, w.tags)), true);
  assert.equal(taskInArea({ ...task, tagIds: ["tag-career"] }, areaTagIds(area, w.tags)), true);
  assert.equal(taskInArea({ ...task, tagIds: ["tag-building"] }, areaTagIds(area, w.tags)), false);
  w.tags[0].name = "Renamed learning";
  assert.equal(w.areas[0].name, "Developer journey");
  for (const t of w.tags) t.deletedAt = meta.createdAt;
  assert.equal(taskInArea(task, areaTagIds(area, w.tags)), false);
  assert.equal(taskInArea(task, null), true);
});
test("deleting areas preserves tags and tasks, while deleting a tag only removes its association", () => {
  const w = emptyWorkspace();
  w.tasks.push({ ...task, tagIds: ["tag-learning"] });
  w.areas.push({ ...meta, id: "area", name: "College", color: "blue", icon: "book", tagIds: ["tag-learning", "tag-career"] });
  assert.throws(() => purgeFromWorkspace(w, "area", "area"));
  w.tags[0].deletedAt = meta.createdAt;
  purgeFromWorkspace(w, "tag", "tag-learning");
  assert.equal(w.areas[0].name, "College");
  assert.deepEqual(w.areas[0].tagIds, ["tag-career"]);
  w.areas[0].deletedAt = meta.createdAt;
  purgeFromWorkspace(w, "area", "area");
  assert.equal(w.tasks.length, 1);
  assert.equal(w.tags.length, 2);
});
