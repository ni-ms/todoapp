import { invoke } from "@tauri-apps/api/core";
import { isDesktop, storage } from "./storage";
import { browserRead, browserWrite } from "./browser-store";
import {
  captureMessages,
  allowedContext,
  taskSchema,
  interpretDrafts,
  type ContextItem,
  type Draft,
} from "./ai-contract";
export type AIProvider = "ollama" | "browser" | "openrouter";
export interface AISettings {
  provider: AIProvider;
  model: string;
  hostedModel: string;
}
export interface LocalAIStatus {
  models: string[];
  model: string;
  ollamaAvailable: boolean;
  speechModel: "whisper" | "phonon-2";
  speechAvailable: boolean;
}
export const browserModel = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
let hostedKey = ""; // User-owned key, memory only; never exported or persisted.
export const setHostedKey = (key: string) => {
  hostedKey = key.trim();
};
export const hasHostedKey = () => Boolean(hostedKey);
export async function aiSettings(): Promise<AISettings> {
  return (
    (await browserRead<AISettings>("ai")) ?? {
      provider: "ollama",
      model: "",
      hostedModel: "openrouter/free",
    }
  );
}
export async function saveAISettings(value: AISettings) {
  if (
    !["ollama", "browser", "openrouter"].includes(value.provider) ||
    value.model.length > 200 ||
    value.model.toLowerCase().includes("cloud") ||
    !/^[\w./:-]{1,200}$/.test(value.hostedModel)
  )
    throw new Error("Choose a valid AI provider and model.");
  await browserWrite("ai", {
    provider: value.provider,
    model: value.model,
    hostedModel: value.hostedModel,
  });
}
// Fixed endpoints only. Fetch cannot bypass the browser's CORS/network/proxy policies.
export async function modelDocument(
  url: string,
  init: RequestInit = {},
  seconds = 180,
): Promise<Record<string, unknown>> {
  const allowed = [
    "http://127.0.0.1:11434/api/tags",
    "http://127.0.0.1:11434/api/show",
    "http://127.0.0.1:11434/api/chat",
    "https://openrouter.ai/api/v1/chat/completions",
  ];
  if (!allowed.includes(url)) throw new Error("Unsupported model endpoint.");
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(seconds * 1000),
    });
  } catch {
    throw new Error(
      url.startsWith("http:")
        ? "Cannot reach the local AI server. Start it and allow this website’s origin in its CORS settings. Your browser may also require local-network permission. See AI setup."
        : "Could not reach OpenRouter. Check your connection and try again.",
    );
  }
  if (!response.ok)
    throw new Error(
      `AI returned HTTP ${response.status}. ${response.status === 429 ? "Usage limit reached; wait or choose another provider." : response.status === 401 ? "Check your API key." : "Check your model and server configuration."}`,
    );
  if (!response.body) throw new Error("AI returned no response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 524288) throw new Error("AI output was too large.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("AI returned unreadable JSON. Nothing was saved.");
  }
}
export async function localAIStatus(): Promise<LocalAIStatus> {
  if (isDesktop()) return invoke("local_ai_status");
  const [ollama, config] = await Promise.all([
    modelDocument("http://127.0.0.1:11434/api/tags", {}, 3).catch(() => null),
    aiSettings(),
  ]);
  const entries = ollama?.models;
  return {
    models: Array.isArray(entries)
      ? entries.flatMap((m) =>
          typeof m?.name === "string" && !m.name.toLowerCase().includes("cloud")
            ? [m.name]
            : [],
        )
      : [],
    model: config.model,
    ollamaAvailable: Boolean(ollama),
    speechModel: "whisper",
    speechAvailable: false,
  };
}
let worker: Worker | undefined;
let engine: import("@mlc-ai/web-llm").WebWorkerMLCEngine | undefined;
let loading: Promise<void> | undefined;
let generating = false;
export function browserModelLoaded() {
  return Boolean(engine);
}
export async function loadBrowserModel(progress: (text: string) => void) {
  if (engine) return;
  if (loading) return loading;
  if (!("gpu" in navigator))
    throw new Error(
      "In-browser AI needs WebGPU. Try current Chrome or Edge, or choose Ollama/hosted AI.",
    );
  loading = (async () => {
    const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
    worker = new Worker(new URL("./ai-worker.ts", import.meta.url), {
      type: "module",
    });
    try {
      engine = await CreateWebWorkerMLCEngine(
        worker,
        browserModel,
        { initProgressCallback: (r) => progress(r.text), logLevel: "SILENT" },
        { context_window_size: 8192 },
      );
    } catch {
      worker.terminate();
      worker = undefined;
      throw new Error(
        "Could not load the browser model. Check WebGPU, free memory, model download access, and storage.",
      );
    }
  })();
  try {
    await loading;
  } finally {
    loading = undefined;
  }
}
export async function unloadBrowserModel() {
  if (generating || loading)
    throw new Error("Wait for the current AI operation to finish.");
  await engine?.unload();
  worker?.terminate();
  worker = undefined;
  engine = undefined;
}
const jsonPost = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
export async function extractTasks(text: string, contexts: ContextItem[], today: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date().toISOString(), calendarIds: string[] = []): Promise<Draft[]> {
  if (isDesktop())
    return invoke("extract_tasks", {
      text,
      contextIds: contexts.map((c) => c.id),
      today, timeZone, now, calendarIds,
    });
  if (!text.trim() ||
    new TextEncoder().encode(text).length > 12000 ||
    contexts.length > 20 ||
    new TextEncoder().encode(text + contexts.map((c) => c.text).join(""))
      .length > 24000)
    throw new Error("Shorten your request or select fewer excerpts (24 KB maximum).");
  if (generating)
    throw new Error("Wait for the current AI request to finish.");
  generating = true;
  try {
    const config = await aiSettings();
    if (calendarIds.length > 20 || new Set(calendarIds).size !== calendarIds.length)
      throw new Error("Choose up to 20 calendar events.");
    const workspace = await storage().load();
    const calendarContext = calendarIds.map((id) => { const e = workspace.events.find((e) => e.id === id && !e.deletedAt); if (!e)
      throw new Error("A selected calendar event is no longer available."); return { id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, timeZone: e.timeZone }; });
    if (new TextEncoder().encode(text + contexts.map((c) => c.text).join("") + JSON.stringify(calendarContext)).length > 24000)
      throw new Error("Select fewer excerpts or calendar events (24 KB maximum).");
    const tags = workspace.tags
      .filter((t) => !t.deletedAt)
      .slice(0, 100)
      .map(({ id, name }) => ({ id, name }));
    const schema = {
      ...taskSchema,
      properties: {
        tasks: {
          ...taskSchema.properties.tasks,
          items: {
            ...taskSchema.properties.tasks.items,
            properties: {
              ...taskSchema.properties.tasks.items.properties,
              tagIds: {
                type: "array",
                maxItems: tags.length ? 20 : 0,
                uniqueItems: true,
                items: {
                  type: "string",
                  ...(tags.length ? { enum: tags.map((t) => t.id) } : {}),
                },
              },
            },
          },
        },
      },
    };
    const messages = captureMessages(text, contexts.map((c) => ({ file: c.name, excerpt: c.text })), calendarContext, today, timeZone, now, tags);
    async function infer(): Promise<string> {
      let raw: string;
      if (config.provider === "browser") {
        if (!engine)
          throw new Error("Download/load the browser model in AI setup first.");
        const result = await engine.chat.completions.create({
          messages,
          temperature: 0,
          max_tokens: 6144,
          response_format: {
            type: "json_object",
            schema: JSON.stringify(schema),
          },
        });
        raw = result.choices[0]?.message.content ?? "";
      }
      else if (config.provider === "openrouter") {
        if (!hostedKey)
          throw new Error("Enter your OpenRouter key in AI setup for this tab.");
        const result = await modelDocument("https://openrouter.ai/api/v1/chat/completions", {
          ...jsonPost({
            model: config.hostedModel,
            messages,
            temperature: 0,
            max_tokens: 6144,
            response_format: { type: "json_object" },
            provider: { data_collection: "deny" },
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hostedKey}`,
          },
        });
        const choices = result.choices as {
          message?: {
            content?: string;
          };
        }[] | undefined;
        raw = choices?.[0]?.message?.content ?? "";
      }
      else {
        if (!config.model || config.model.toLowerCase().includes("cloud"))
          throw new Error("Choose an installed local model in AI setup first.");
        const details = await modelDocument("http://127.0.0.1:11434/api/show", jsonPost({ model: config.model }));
        if (details.remote_host ||
          details.remote_model ||
          !details.model_info ||
          typeof details.model_info !== "object" ||
          Array.isArray(details.model_info) ||
          !Object.keys(details.model_info).length)
          throw new Error("Use a downloaded local model, not an Ollama cloud model.");
        const result = await modelDocument("http://127.0.0.1:11434/api/chat", jsonPost({
          model: config.model,
          messages,
          stream: false,
          think: false,
          format: schema,
          options: { temperature: 0, num_ctx: 32768, num_predict: 6144 },
        }));
        raw = (result.message as {
          content?: string;
        })?.content ?? "";
      }
      return raw;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await infer();
      try {
        return interpretDrafts(raw, tags.map((t) => t.id), text, { today, timeZone, calendarContext });
      }
      catch (error) {
        if (attempt)
          throw error;
        // Repair stays with the selected provider and never saves or executes output.
        messages.push({ role: "user", content: "Your response did not pass validation. Return the original requested tasks again using every required schema field. Validation: " + String(error).slice(0, 500) });
      }
    }
    throw new Error("No valid task drafts returned.");
  }
  finally {
    generating = false;
  }
}
export async function transcribeAudio(
  audio: string,
  signal?: AbortSignal,
): Promise<string> {
  if (isDesktop()) return invoke("transcribe_audio", { audio });
  const { transcribeBrowserAudio } = await import("./speech");
  return transcribeBrowserAudio(audio, signal);
}
export async function readContextFiles(
  files: File[],
): Promise<{ items: ContextItem[]; skipped: number }> {
  const items: ContextItem[] = [];
  let total = 0,
    skipped = 0;
  for (const file of files.slice(0, 2000)) {
    const name = file.webkitRelativePath || file.name;
    if (
      items.length >= 20 ||
      total >= 60000 ||
      !allowedContext(name, file.size)
    ) {
      skipped++;
      continue;
    }
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      if (text.includes("\0")) {
        skipped++;
        continue;
      }
      // Re-encode after slicing so UTF-8 excerpts stay within the byte budget.
      const cap = Math.min(6000, 60000 - total);
      let excerpt = "";
      let length = 0;
      for (const char of text) {
        const n = new TextEncoder().encode(char).length;
        if (length + n > cap) break;
        excerpt += char;
        length += n;
      }
      total += length;
      items.push({
        id: crypto.randomUUID(),
        name,
        text: excerpt,
        truncated: excerpt.length < text.length,
      });
    } catch {
      skipped++;
    }
  }
  return { items, skipped: skipped + Math.max(0, files.length - 2000) };
}
