import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedContext, validateDrafts } from "../lib/ai-contract";
import {
  modelDocument,
  extractTasks,
  readContextFiles,
  aiSettings,
  saveAISettings,
  setHostedKey,
  hasHostedKey,
} from "../lib/ai";
import { browserRead, workspaceBackup } from "../lib/browser-store";
import { emptyWorkspace } from "../lib/domain";
const draft = {
  title: "Study",
  description: "",
  priority: "high",
  dueDate: null,
  estimateMinutes: 30,
  tagIds: ["tag-learning"],
};
test("all AI providers share strict draft validation and cannot introduce tools or unknown tags", () => {
  assert.equal(
    validateDrafts(JSON.stringify({ tasks: [draft] }), ["tag-learning"]).length,
    1,
  );
  for (const d of [
    { ...draft, tool: "execute" },
    { ...draft, title: "" },
    { ...draft, estimateMinutes: 1 },
    { ...draft, dueDate: "2026-02-30" },
    { ...draft, dueDate: "" },
    { ...draft, tagIds: ["unknown"] },
    { ...draft, tagIds: ["tag-learning", "tag-learning"] },
  ])
    assert.throws(() =>
      validateDrafts(JSON.stringify({ tasks: [d] }), ["tag-learning"]),
    );
  assert.throws(() => validateDrafts('{"tasks":[],"tools":[]}', []));
  assert.throws(
    () =>
      validateDrafts(
        JSON.stringify({ tasks: [draft, { ...draft, dueDate: "2026-10-16" }] }),
        ["tag-learning"],
      ),
    /repeated/,
  );
  assert.throws(() =>
    validateDrafts(JSON.stringify({ tasks: Array(11).fill(draft) }), [
      "tag-learning",
    ]),
  );
});
test("browser attachments exclude hidden/generated/sensitive paths and bound file and excerpt sizes", async () => {
  for (const name of [
    ".env",
    ".git/config.ts",
    "node_modules/test.ts",
    "src/credentials.ts",
    "password.txt",
    "package-lock.json",
    "notes.pdf",
    "a/b/c/d/e/f/g.txt",
  ])
    assert.equal(allowedContext(name, 10), false, name);
  assert.equal(allowedContext("notes.md", 128001), false);
  const result = await readContextFiles([
    new File(["é".repeat(5000)], "notes.md"),
    new File([new Uint8Array([255])], "invalid.txt"),
    new File(["\0"], "binary.txt"),
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped, 2);
  assert.ok(result.items[0].truncated);
  assert.equal(new TextEncoder().encode(result.items[0].text).length, 6000);
});
test("AI transport restricts destinations, refuses redirects, bounds output, and never persists hosted keys", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.redirect, "error");
      assert.equal(init?.credentials, "omit");
      return new Response(JSON.stringify({ models: [] }));
    };
    await modelDocument("http://127.0.0.1:11434/api/tags");
    await assert.rejects(
      modelDocument("https://attacker.example/api/chat"),
      /Unsupported/,
    );
    globalThis.fetch = async () => new Response("x".repeat(524289));
    await assert.rejects(
      modelDocument("http://127.0.0.1:11434/api/tags"),
      /too large/,
    );
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    await assert.rejects(
      modelDocument("https://openrouter.ai/api/v1/chat/completions"),
      /Usage limit/,
    );
    await saveAISettings({
      provider: "openrouter",
      model: "",
      hostedModel: "openrouter/free",
    });
    setHostedKey("session-secret");
    assert.equal(hasHostedKey(), true);
    assert.ok(
      !JSON.stringify(await browserRead("ai")).includes("session-secret"),
    );
    assert.ok(!workspaceBackup(emptyWorkspace()).includes("session-secret"));
    assert.equal((await aiSettings()).provider, "openrouter");
    setHostedKey("");
    assert.equal(hasHostedKey(), false);
    await assert.rejects(
      saveAISettings({
        provider: "ollama",
        model: "qwen:cloud",
        hostedModel: "openrouter/free",
      }),
      /valid AI/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    setHostedKey("");
  }
});

test("hosted capture sends only explicit input and tags, validates output, and never falls back across providers", async () => {
  const { storage } = await import("../lib/storage");
  const before = await storage().saveTasks([
    {
      title: "PRIVATE EXISTING TASK",
      description: "Never send this",
      priority: "medium",
      dueDate: null,
      estimateMinutes: 30,
      tagIds: [],
      courseId: null,
      kind: "study",
      status: "todo",
    },
  ]);
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    await saveAISettings({
      provider: "openrouter",
      model: "",
      hostedModel: "openrouter/free",
    });
    setHostedKey("temporary-test-key");
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.provider.data_collection, "deny");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer temporary-test-key",
      );
      assert.ok(String(init?.body).includes("Explicit request"));
      assert.ok(!String(init?.body).includes("PRIVATE EXISTING TASK"));
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ tasks: [draft] }) } }],
      });
    };
    assert.equal(
      (await extractTasks("Explicit request", [], "2026-10-15")).length,
      1,
    );
    assert.deepEqual(await storage().load(), before);
    await saveAISettings({
      provider: "browser",
      model: "",
      hostedModel: "openrouter/free",
    });
    await assert.rejects(
      extractTasks("Explicit request", [], "2026-10-15"),
      /load the browser model/i,
    );
    assert.equal(calls.length, 1);
    await saveAISettings({
      provider: "ollama",
      model: "downloaded-model",
      hostedModel: "openrouter/free",
    });
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return Response.json({
        remote_host: "cloud.example",
        model_info: { architecture: "test" },
      });
    };
    await assert.rejects(
      extractTasks("Explicit request", [], "2026-10-15"),
      /not an Ollama cloud model/,
    );
    assert.deepEqual(calls, [
      "https://openrouter.ai/api/v1/chat/completions",
      "http://127.0.0.1:11434/api/show",
    ]);
    assert.deepEqual(await storage().load(), before);
  } finally {
    globalThis.fetch = oldFetch;
    setHostedKey("");
  }
});
