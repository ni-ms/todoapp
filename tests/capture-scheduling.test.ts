import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import capture from "./fixtures/capture-benchmark.json";
import parity from "./fixtures/scheduling-parity.json";
import { validateDrafts, capturePrompt } from "../lib/ai-contract";
import { defaultScheduling } from "../lib/task-scheduling";
import { plan, applyProposal, undoProposal } from "../lib/planning";
import { storage } from "../lib/storage";
import { taskInput, type Workspace } from "../lib/domain";
for (const c of capture)
    test(`capture contract: ${c.name}`, () => {
        const tasks = validateDrafts(JSON.stringify({ tasks: c.tasks }), []);
        assert.deepEqual(tasks, c.tasks);
        assert.ok(capturePrompt(c.today, c.timeZone, c.now, []).includes(c.today));
    });
for (const c of parity)
    test(`matching browser/native schedule: ${c.name}`, () => {
        const w = structuredClone(c.workspace) as Workspace;
        const p = plan(w, c.options, Date.parse(c.now), "fixture");
        assert.deepEqual(p.events.map((e) => ({ taskId: e.taskId, start: Date.parse(e.start), end: Date.parse(e.end) })), c.blocks.map((e) => ({ taskId: e.taskId, start: Date.parse(e.start), end: Date.parse(e.end) })));
        assert.deepEqual(p.unscheduled.map(({ title, minutes }) => ({ title, minutes })), c.unscheduled.map(({ title, minutes }) => ({ title, minutes })));
        for (const warning of c.unscheduled) {
            if ("reason" in warning) {
                const actual = p.unscheduled.find((item) => item.taskId === warning.taskId);
                assert.equal(actual?.reason, warning.reason);
            }
        }
        // Review/apply/undo remains atomic with all new task metadata present.
        if (p.events.length) {
            const added = applyProposal(w, p, c.now);
            undoProposal(w, added, c.now);
            assert.deepEqual(w.tasks, c.workspace.tasks);
        }
    });
test("capture dependencies resolve to durable IDs in a single batch and survive edits", async () => {
    const c = capture.find((c) => c.name === "prerequisites")!;
    const inputs = validateDrafts(JSON.stringify({ tasks: c.tasks }), []).map((d) => ({ ...d, courseId: null, kind: "study" as const, status: "todo" as const }));
    const saved = await storage().saveTasks(inputs), [read, exercise] = saved.tasks.slice(-2);
    assert.deepEqual(exercise.scheduling?.dependencies, [read.id]);
    assert.deepEqual((await storage().saveTask({ ...taskInput(exercise), title: "Updated exercise" })).tasks.find((t) => t.id === exercise.id)?.scheduling, exercise.scheduling);
    const before = await storage().load();
    await assert.rejects(storage().saveTasks([{ ...inputs[0], scheduling: { ...inputs[0].scheduling, dependencies: ["draft:20"] } }]));
    assert.deepEqual(await storage().load(), before);
});
test("strict validation rejects unsupported instructions, missing nulls, bad zones, and impossible fixed blocks", () => {
    const draft = capture[0].tasks[0];
    for (const scheduling of [
        { ...defaultScheduling(), timeZone: "+04:00" },
        { ...defaultScheduling(), remainingMinutes: 1000 },
        { ...defaultScheduling(), fixedStart: "2026-10-16T18:00:00-07:00", fixedEnd: "2026-10-16T17:00:00-07:00" },
        { ...defaultScheduling(), allowedWindows: [{ days: [4], start: "22:00", end: "20:00" }] },
        { ...defaultScheduling(), unresolved: [""] },
        { ...defaultScheduling(), workDate: "2026-02-30" },
    ])
        assert.throws(() => validateDrafts(JSON.stringify({ tasks: [{ ...draft, scheduling }] }), []));
    const { deadlineAt: _unused, ...missing } = defaultScheduling();
    void _unused;
    assert.throws(() => validateDrafts(JSON.stringify({ tasks: [{ ...draft, scheduling: missing }] }), []));
});
test("benchmark flags invented facts and separates interpretation from wording", async () => {
    const { scoreCapture } = await import("../lib/capture-benchmark");
    const reference = validateDrafts(JSON.stringify({ tasks: capture[0].tasks }), []);
    assert.equal(scoreCapture(reference, reference.map((d) => ({ ...d, title: "Another valid title", description: "Different notes" }))).allPassed, true);
    assert.equal(scoreCapture(reference, reference.map((d) => ({ ...d, scheduling: { ...d.scheduling, earliestStart: "2026-10-16T08:00:00Z" } }))).allPassed, false);
    assert.equal(scoreCapture(reference, [...reference, ...reference]).taskCount, false);
});
test("benchmark accepts equivalent representations but still rejects dropped constraints and wrong clarification", async () => {
  const { scoreCapture } = await import("../lib/capture-benchmark");
  const reference = validateDrafts(JSON.stringify({tasks:capture[0].tasks}),[]);
  const estimated = reference.map((d)=>({...d,estimateMinutes:135,estimatedFields:[...d.estimatedFields].reverse()}));
  assert.equal(scoreCapture(reference,estimated).allPassed,true);
  assert.equal(scoreCapture(reference,estimated.map((d)=>({...d,estimatedFields:["priority"]}))).allPassed,false);
  const explicit=validateDrafts(JSON.stringify({tasks:capture[4].tasks}),[]);
  const equivalent=explicit.map((d)=>({...d,scheduling:{...d.scheduling,allowedWindows:d.scheduling.allowedWindows.flatMap((w)=>w.days.map((day)=>({...w,days:[day]}))).reverse()}}));
  assert.equal(scoreCapture(explicit,equivalent).allPassed,true);
  assert.equal(scoreCapture(explicit,equivalent.map((d)=>({...d,scheduling:{...d.scheduling,allowedWindows:[]}}))).allPassed,false);
  const ambiguous = capture.find((c)=>c.name==="ambiguous time")!;
  const drafts=validateDrafts(JSON.stringify({tasks:ambiguous.tasks}),[]);
  assert.equal(scoreCapture(drafts,drafts.map((d)=>({...d,scheduling:{...d.scheduling,unresolved:["Which day is Friday?"]}})),ambiguous.checks).allPassed,false);
});
test("replays saved local-model failures and independent phrase fixtures",async()=>{
 const {default:cases}=await import("./fixtures/capture-resolution.json");
 const {interpretDrafts}=await import("../lib/ai-contract");
 for(const c of cases)assert.deepEqual(interpretDrafts(JSON.stringify({tasks:c.raw}),[],c.request,c),c.expected,c.name);
});
test("browser prompt and examples match the native shared fixture",async()=>{
 const {default:c}=await import("./fixtures/capture-message-parity.json");
 const {captureMessages}=await import("../lib/ai-contract");
 assert.deepEqual(captureMessages(c.request,c.context,c.calendarContext,c.today,c.timeZone,c.now,c.tags),c.messages);
});
test("explicit resolution preserves unsupported questions and avoids applying global rules to separate tasks",async()=>{
 const {interpretDrafts}=await import("../lib/ai-contract");
 const c=capture.find((c)=>c.name==="unresolved class")!;
 const raw=structuredClone(c.tasks);raw[0].scheduling.unresolved=["Importing the campus portal is unsupported."];
 const resolved=interpretDrafts(JSON.stringify({tasks:raw}),[],c.request,c);
 assert.ok(resolved[0].scheduling.unresolved.includes("Importing the campus portal is unsupported."));
 assert.ok(resolved[0].scheduling.unresolved.some((q)=>q.includes("Which class")));
 const batch=capture.find((c)=>c.name==="prerequisites")!.tasks;
 const unchanged=interpretDrafts(JSON.stringify({tasks:batch}),[],"Read for 30 minutes and attempt exercises for 45 minutes; prefer evenings for the exercises only.",c);
 assert.deepEqual(unchanged[0].scheduling.preferredWindows,[]);
 assert.deepEqual(unchanged[1].scheduling.dependencies,[]);
});
test("explicit resolution respects negative splitting and edits only obsolete duration text",async()=>{
 const {interpretDrafts}=await import("../lib/ai-contract");
 const c=capture[0],raw={...c.tasks[0],title:"Read chapter 90 for 60 minutes",dueDate:null,estimateMinutes:60,scheduling:defaultScheduling(c.timeZone)};
 const corrected=interpretDrafts(JSON.stringify({tasks:[raw]}),[],"Read chapter 90 for 60 minutes. Actually, make that 40 minutes, do not split it.",c)[0];
 assert.equal(corrected.title,"Read chapter 90 for 40 minutes");assert.equal(corrected.estimateMinutes,40);assert.equal(corrected.scheduling.splittable,false);
 const after=interpretDrafts(JSON.stringify({tasks:[raw]}),[],"Start reading after Friday for 30 minutes.",c)[0];
 assert.equal(after.scheduling.workDate,null);
});
test("range effort is explicit and unsupported compound numbers are not partially parsed",async()=>{
 const {interpretDrafts}=await import("../lib/ai-contract");const c=capture[0];
 const raw={...c.tasks[0],title:"Study",dueDate:null,estimateMinutes:25,estimatedFields:["priority"],scheduling:defaultScheduling(c.timeZone)};
 const range=interpretDrafts(JSON.stringify({tasks:[raw]}),[],"Study Friday from 2 pm to 3 pm.",c)[0];
 assert.equal(range.estimateMinutes,60);assert.deepEqual(range.estimatedFields,["priority"]);
 assert.equal(range.scheduling.splittable,false);
 const compound=interpretDrafts(JSON.stringify({tasks:[{...raw,estimateMinutes:45}]}),[],"Study for forty-five minutes.",c)[0];
 assert.equal(compound.estimateMinutes,45);assert.deepEqual(compound.estimatedFields,["priority"]);
});

test("AI task order stays optional until selected in review, then survives batch persistence", async () => {
    const { prepareDraftReview } = await import("../lib/capture-review");
    const { interpretDrafts } = await import("../lib/ai-contract");
    const c = capture.find((c) => c.name === "prerequisites")!;
    const interpreted = interpretDrafts(JSON.stringify({ tasks: c.tasks }), [], c.request, c);
    const reviewed = prepareDraftReview(interpreted);
    assert.deepEqual(reviewed[1].suggestedDependencies, ["draft:0"]);
    assert.ok(reviewed.every((d) => d.scheduling.dependencies.length === 0));
    assert.deepEqual(interpreted[1].scheduling.dependencies, ["draft:0"]);
    const inputs = reviewed.map((d) => ({ ...d, courseId: null, kind: "study" as const, status: "todo" as const }));
    const independent = await storage().saveTasks(inputs);
    assert.ok(independent.tasks.slice(-2).every((t) => t.scheduling?.dependencies.length === 0));
    reviewed[1].scheduling.dependencies = ["draft:0"];
    const selected = await storage().saveTasks(reviewed.map((d) => ({ ...d, courseId: null, kind: "study" as const, status: "todo" as const })));
    const [read, exercise] = selected.tasks.slice(-2);
    assert.deepEqual(exercise.scheduling?.dependencies, [read.id]);
});

test("explicit AI order rejects self-links and cycles instead of saving blocked tasks", async () => {
    const { interpretDrafts } = await import("../lib/ai-contract");
    const c = capture.find((c) => c.name === "prerequisites")!;
    const raw = structuredClone(c.tasks);
    raw[0].scheduling.dependencies = ["draft:1"];
    assert.throws(() => interpretDrafts(JSON.stringify({ tasks: raw }), [], "Read after practicing exercises.", c), /loop/);
    raw[0].scheduling.dependencies = ["draft:0"];
    assert.throws(() => interpretDrafts(JSON.stringify({ tasks: raw }), [], "Read first, then practice exercises.", c), /loop/);
});

test("repairing existing unintended prerequisites preserves task details and unblocks planning", async () => {
    const c = capture[0];
    const input = { ...validateDrafts(JSON.stringify({ tasks: c.tasks }), [])[0], title: "Finish fse assignment", dueDate: null, courseId: null, kind: "study" as const, status: "todo" as const, scheduling: { ...defaultScheduling(c.timeZone), dependencies: ["draft:0"] } };
    const saved = await storage().saveTasks([input]);
    const task = saved.tasks.at(-1)!;
    const w: Workspace = { ...saved, tasks: [task], events: [] };
    const options = { startDate: c.today, timeZone: c.timeZone, startHour: 9, endHour: 17, weekends: true, breakMinutes: 0 };
    assert.match(plan(w, options, Date.parse(c.now), "blocked").unscheduled[0].reason, /lists itself/);
    const repaired = await storage().saveTask({ ...taskInput(task), scheduling: { ...task.scheduling!, dependencies: [] } });
    const actual = repaired.tasks.find((t) => t.id === task.id)!;
    assert.deepEqual(actual, { ...task, updatedAt: actual.updatedAt, scheduling: { ...task.scheduling!, dependencies: [] } });
    assert.deepEqual(repaired.events, saved.events);
    const result = plan({ ...w, tasks: [actual] }, options, Date.parse(c.now), "repaired");
    assert.deepEqual(result.unscheduled, []);
    assert.ok(result.events.some((event) => event.taskId === task.id));
});
