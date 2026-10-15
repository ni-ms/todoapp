"use client";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic, Square, Paperclip, FolderPlus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagPicker } from "@/components/tag-manager";
import { isDesktop } from "@/lib/storage";
import {
  localDate,
  validateTask,
  type Tag,
  type TaskInput,
} from "@/lib/domain";
import { recordingWav } from "@/lib/audio";
interface ContextItem {
  id: string;
  name: string;
  text: string;
  truncated: boolean;
  selected: boolean;
}
interface Draft {
  title: string;
  description: string;
  priority: TaskInput["priority"];
  dueDate: string | null;
  estimateMinutes: number;
  tagIds: string[];
  selected: boolean;
}
export function TaskCapture({
  tags,
  defaultTag,
  onSave,
  onSettings,
}: {
  tags: Tag[];
  defaultTag?: string;
  onSave: (inputs: TaskInput[]) => Promise<void>;
  onSettings: () => void;
}) {
  const [text, setText] = useState(""),
    [contexts, setContexts] = useState<ContextItem[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [error, setError] = useState(""),
    [hint, setHint] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true),
    contextsRef = useRef<ContextItem[]>([]);
  useEffect(() => {
    contextsRef.current = contexts;
  }, [contexts]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      for (const c of contextsRef.current)
        invoke("remove_context", { id: c.id }).catch(() => {});
    };
  }, []);
  async function attach(folder: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<{
        items: Omit<ContextItem, "selected">[];
        skipped: number;
      }>("pick_context", { folder });
      setContexts((c) => [
        ...c,
        ...result.items.map((i) => ({ ...i, selected: true })),
      ]);
      setHint(
        `${result.items.length} text/code files added.${result.skipped ? " Unsupported, large, hidden, generated, or sensitive-name files were skipped." : ""}`,
      );
      setDrafts([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function mic() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError("");
    setHint("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Microphone capture is unavailable in this runtime. You can type your request.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const capture = new MediaRecorder(media);
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      capture.onstop = async () => {
        media.getTracks().forEach((t) => t.stop());
        if (timer.current) clearTimeout(timer.current);
        if (!mounted.current) return;
        setRecording(false);
        setBusy(true);
        try {
          const audio = await recordingWav(
            new Blob(chunks, { type: capture.mimeType }),
          );
          if (!mounted.current) return;
          const transcript = await invoke<string>("transcribe_audio", {
            audio,
          });
          if (mounted.current) {
            setText((previous) =>
              [previous, transcript].filter(Boolean).join("\n"),
            );
            setDrafts([]);
            setHint("Transcript ready. Edit it, then create task drafts.");
          }
        } catch (e) {
          if (mounted.current) setError(String(e));
        } finally {
          if (mounted.current) setBusy(false);
        }
      };
      capture.onerror = () => {
        media.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setError("Recording failed. Try again or type your request.");
      };
      capture.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (capture.state === "recording") capture.stop();
      }, 90000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function generate() {
    setBusy(true);
    setError("");
    setDrafts([]);
    try {
      const result = await invoke<Omit<Draft, "selected">[]>("extract_tasks", {
        text,
        contextIds: contexts.filter((c) => c.selected).map((c) => c.id),
        today: localDate(),
      });
      if (mounted.current)
        setDrafts(result.map((d) => ({ ...d, tagIds: [...new Set([...d.tagIds, ...(defaultTag && tags.some((tag) => tag.id === defaultTag && !tag.deletedAt) ? [defaultTag] : [])])], selected: true })));
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const change = (index: number, patch: Partial<Draft>) =>
    setDrafts((all) =>
      all.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  return (
    <section className="surface mb-6 p-5 sm:p-6" aria-label="Task capture">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          What do you need to get done?
        </h2>
        <Button size="sm" variant="ghost" onClick={onSettings}>
          Local AI setup
        </Button>
      </div>
      <Textarea
        aria-label="Task request"
        placeholder="I need to finish my algorithms assignment by Friday and spend an hour on my portfolio…"
        maxLength={12000}
        value={text}
        disabled={busy || recording}
        onChange={(e) => {
          setText(e.target.value);
          setDrafts([]);
        }}
        className="min-h-24"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={recording ? "destructive" : "outline"}
          disabled={busy || !isDesktop()}
          onClick={mic}
          aria-label={recording ? "Stop recording" : "Record task request"}
        >
          {recording ? <Square /> : <Mic />}
          {recording ? "Stop recording" : "Record"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || recording || !isDesktop()}
          onClick={() => attach(false)}
        >
          <Paperclip />
          Files
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || recording || !isDesktop()}
          onClick={() => attach(true)}
        >
          <FolderPlus />
          Folder
        </Button>
        <Button
          size="sm"
          className="sm:ml-auto"
          disabled={busy || recording || !text.trim() || !isDesktop()}
          onClick={generate}
        >
          <Sparkles />
          {busy ? "Working locally…" : "Create task drafts"}
        </Button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {recording
          ? "Recording… Stops after 90 seconds. Audio goes only to your local Whisper server."
          : isDesktop()
            ? "Type or record, review the drafts, then add them. Selected file excerpts go only to your local model."
            : "Open the desktop app to use local AI, recording, and file context."}
      </p>
      {contexts.length > 0 && (
        <details className="mt-4 rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            Review file context ({contexts.length})
          </summary>
          <p className="my-3 text-muted-foreground">
            Only checked excerpts will be used. Attachments clear when you leave
            this page.
          </p>
          {contexts.map((c) => (
            <div key={c.id} className="border-t py-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Use ${c.name}`}
                  checked={c.selected}
                  disabled={busy}
                  onChange={(e) => {
                    setContexts((all) =>
                      all.map((i) =>
                        i.id === c.id
                          ? { ...i, selected: e.target.checked }
                          : i,
                      ),
                    );
                    setDrafts([]);
                  }}
                />
                <span className="min-w-0 flex-1 break-all">
                  {c.name}
                  {c.truncated ? " (excerpt)" : ""}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy}
                  aria-label={`Remove ${c.name}`}
                  onClick={async () => {
                    try {
                      await invoke("remove_context", { id: c.id });
                      setContexts((all) => all.filter((i) => i.id !== c.id));
                      setDrafts([]);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  <X />
                </Button>
              </div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">
                {c.text}
              </pre>
            </div>
          ))}
        </details>
      )}
      {hint && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {drafts.length > 0 && (
        <div className="mt-5 space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">Review task drafts</h3>
          {drafts.map((d, index) => (
            <fieldset
              key={index}
              disabled={busy}
              className="space-y-3 rounded-lg border p-4"
            >
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) =>
                    change(index, { selected: e.target.checked })
                  }
                />
                Add this task
              </label>
              <Input
                aria-label={`Task ${index + 1} title`}
                maxLength={200}
                value={d.title}
                onChange={(e) => change(index, { title: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1 text-xs">
                  Due date
                  <Input
                    type="date"
                    value={d.dueDate ?? ""}
                    onInput={(e) =>
                      change(index, { dueDate: e.currentTarget.value || null })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs">
                  Minutes
                  <Input
                    type="number"
                    min={5}
                    max={1440}
                    value={d.estimateMinutes}
                    onChange={(e) =>
                      change(index, { estimateMinutes: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs">
                  Priority
                  <select
                    className="field-select"
                    value={d.priority}
                    onChange={(e) =>
                      change(index, {
                        priority: e.target.value as Draft["priority"],
                      })
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <Textarea
                aria-label={`Task ${index + 1} notes`}
                maxLength={4000}
                value={d.description}
                onChange={(e) => change(index, { description: e.target.value })}
              />
              <TagPicker
                tags={tags}
                value={d.tagIds}
                onChange={(ids) => change(index, { tagIds: ids })}
              />
            </fieldset>
          ))}
          <Button
            disabled={busy || !drafts.some((d) => d.selected)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const inputs = drafts
                  .filter((d) => d.selected)
                  .map((d) => ({
                    title: d.title,
                    description: d.description,
                    priority: d.priority,
                    dueDate: d.dueDate,
                    estimateMinutes: d.estimateMinutes,
                    tagIds: d.tagIds,
                    courseId: null,
                    kind: "study" as const,
                    status: "todo" as const,
                  }));
                inputs.forEach(validateTask);
                await onSave(inputs);
                setDrafts([]);
                setText("");
                setHint("Tasks added. Use Plan my week to find time for them.");
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Add {drafts.filter((d) => d.selected).length} tasks
          </Button>
        </div>
      )}
    </section>
  );
}
