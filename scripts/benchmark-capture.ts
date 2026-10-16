import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import baseline from "../tests/fixtures/capture-benchmark.json";
import holdout from "../tests/fixtures/capture-holdout.json";
import type { CaptureChecks } from "../lib/capture-benchmark";
import type { CaptureContext } from "../lib/capture-resolution";
const fixtures = [...baseline, ...holdout] as {
    name: string;
    request: string;
    today: string;
    timeZone: string;
    now: string;
    tasks: Draft[];
    checks: CaptureChecks;
    calendarContext?: NonNullable<CaptureContext["calendarContext"]>;
}[];
import { captureMessages, taskSchema, interpretDrafts, validateDrafts, type Draft } from "../lib/ai-contract";
import { scoreCapture } from "../lib/capture-benchmark";
const thinking = process.env.DAYMARK_CAPTURE_THINK === "1";
const selectedCases = fixtures.filter((c) => !process.env.DAYMARK_CAPTURE_CASE || process.env.DAYMARK_CAPTURE_CASE.split(",").includes(c.name));
const models = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!models.length)
    throw new Error("Supply one or more installed local Ollama model names. No models are downloaded by this benchmark.");
async function post(path: string, body: unknown) {
    const response = await fetch(`http://127.0.0.1:11434/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(180000) });
    if (!response.ok)
        throw new Error(`Local inference failed (${response.status}).`);
    const raw = await response.text();
    if (raw.length > 524288)
        throw new Error("Model response too large.");
    return JSON.parse(raw);
}
if (!selectedCases.length) throw new Error("No benchmark case matches DAYMARK_CAPTURE_CASE.");
const implementationSha256=createHash("sha256").update((await Promise.all(["../lib/ai-contract.ts","../lib/capture-resolution.ts","../lib/capture-contract.json","../lib/capture-rules.json","../lib/capture-benchmark.ts"].map((path)=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n")).digest("hex");
const startedAt = new Date().toISOString();
const environment = { platform: process.platform, arch: process.arch, node: process.version, cpu: cpus()[0]?.model, logicalCores: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3) };
const results: {
    model: string;
    case: string;
    milliseconds: number;
    attempts: number;
    score: ReturnType<typeof scoreCapture> | null;
    error: string | null;
    actual: Draft[] | null;
    rawModelScore: ReturnType<typeof scoreCapture> | null;
    responses: {
        content: string;
        loadMilliseconds: number;
        promptTokens: number;
        outputTokens: number;
        outputMilliseconds: number;
    }[];
}[] = [];
for (const model of models) {
    const details = await post("show", { model });
    if (model.toLowerCase().includes("cloud") || details.remote_host || details.remote_model || !details.model_info || !Object.keys(details.model_info).length)
        throw new Error("Use installed local models only.");
    for (const c of selectedCases) {
        const messages = captureMessages(c.request, [], c.calendarContext ?? [], c.today, c.timeZone, c.now, []);
        const started = performance.now();
        let error: string | null = null, actual: Draft[] | null = null, attempts = 0;
        const responses: {
            content: string;
            loadMilliseconds: number;
            promptTokens: number;
            outputTokens: number;
            outputMilliseconds: number;
        }[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
            attempts++;
            let result;
            try {
                result = await post("chat", { model, stream: false, think: thinking, format: taskSchema, options: { temperature: 0, num_ctx: 32768, num_predict: 6144 }, messages });
            }
            catch (e) {
                error = String(e);
                break;
            }
            responses.push({ content: result.message?.content ?? "", loadMilliseconds: Math.round((result.load_duration ?? 0) / 1e6), promptTokens: result.prompt_eval_count ?? 0, outputTokens: result.eval_count ?? 0, outputMilliseconds: Math.round((result.eval_duration ?? 0) / 1e6) });
            try {
                actual = interpretDrafts(result.message?.content ?? "", [], c.request, { today: c.today, timeZone: c.timeZone, calendarContext: c.calendarContext });
                error = null;
                break;
            }
            catch (e) {
                error = String(e);
                messages.push({ role: "user", content: `Your response did not pass validation. Return the original requested tasks again using every required schema field. Validation: ${error.slice(0, 500)}` });
            }
        }
        const score = actual ? scoreCapture(c.tasks as Draft[], actual, c.checks) : null;
        let rawModelScore = null;
        try {
            rawModelScore = scoreCapture(c.tasks, validateDrafts(responses.at(-1)?.content ?? "", []), c.checks);
        }
        catch { }
        const row = { model, case: c.name, rawModelScore, actual, responses, milliseconds: Math.round(performance.now() - started), attempts, score, error };
        results.push(row);
        await writeFile(process.env.DAYMARK_BENCHMARK_OUTPUT ?? "/tmp/daymark-capture-benchmark.json", JSON.stringify({ startedAt, implementationSha256, environment, stage: "capture interpretation pipeline; partial run", settings: { think: thinking, temperature: 0, num_ctx: 32768, num_predict: 6144 }, results }, null, 2) + "\n");
        console.log(`${model} · ${c.name}: ${score?.allPassed ? "PASS" : "FAIL"} (${row.milliseconds} ms, ${attempts} attempt(s))`);
    }
}
const summary = models.map((model) => { const rows = results.filter((r) => r.model === model), times = rows.map((r) => r.milliseconds).sort((a, b) => a - b); return { model, cases: rows.length, passed: rows.filter((r) => r.score?.allPassed).length, valid: rows.filter((r) => r.score).length, rawModelPassed: rows.filter((r) => r.rawModelScore?.allPassed).length, medianMilliseconds: times[Math.floor(times.length / 2)], p95Milliseconds: times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)] }; });
const output = process.env.DAYMARK_BENCHMARK_OUTPUT ?? "/tmp/daymark-capture-benchmark.json";
await writeFile(output, JSON.stringify({ startedAt, implementationSha256, environment, stage: "capture interpretation pipeline (schema and explicit resolution); no speech or workspace writes", settings: { think: thinking, temperature: 0, num_ctx: 32768, num_predict: 6144 }, summary, results }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
console.log(`Report saved to ${output}`);
