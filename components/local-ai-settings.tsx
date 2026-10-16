"use client";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/storage";
import { BrowserAISettings } from "./browser-ai-settings";
import { LocalAIInstaller } from "./local-ai-installer";
import type { LocalAIStatus } from "@/lib/ai";
export type { LocalAIStatus } from "@/lib/ai";
export function LocalAISettings() {
  return isDesktop() ? <NativeAISettings /> : <BrowserAISettings />;
}
function NativeAISettings() {
  const [status, setStatus] = useState<LocalAIStatus | null>(null),
    [error, setError] = useState(""),
    [working, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const busy = working || installing;
  const refresh = useCallback(() => {
    void invoke<LocalAIStatus>("local_ai_status").then(setStatus).catch((e) => setError(String(e)));
  }, []);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus(await invoke<LocalAIStatus>("local_ai_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    invoke<LocalAIStatus>("local_ai_status")
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="surface space-y-4 p-6">
      <h2 className="text-sm font-semibold">Local AI</h2>
      <p className="text-sm text-muted-foreground">
        Task drafts and voice transcription stay on this device.
      </p>
      <LocalAIInstaller onBusyChange={setInstalling} refresh={refresh} taskModelInstalled={Boolean(status?.models.includes("qwen3:4b"))} />
      {isDesktop() ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              Ollama: {status?.ollamaAvailable ? "running" : "not connected"}
            </span>
            <span>
              Speech: {status?.speechAvailable ? "running" : "not connected"}
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={check}>
              Check connection
            </Button>
          </div>
          <label className="block space-y-2 text-xs">
            <span>Speech model</span>
            <select className="field-select" value={status?.speechModel ?? "whisper"}
              disabled={busy || !status}
              onChange={async (e) => {
                const model = e.target.value;
                setBusy(true);
                setError("");
                try {
                  await invoke("configure_local_speech", { model });
                  setStatus(await invoke<LocalAIStatus>("local_ai_status"));
                } catch (e) { setError(String(e)); }
                finally { setBusy(false); }
              }}>
              <option value="phonon-2">Phonon 2 · English</option>
              <option value="whisper">Whisper base.en · English</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Download a speech model above, select it, then start local AI.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setStatus(await invoke<LocalAIStatus>("start_local_ai"));
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Start local AI
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await invoke("stop_local_ai");
                  setStatus(await invoke<LocalAIStatus>("local_ai_status"));
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Stop app-started services
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            App-started services stop when you quit Daymark.
          </p>
          <label className="block space-y-2 text-xs">
            <span>Task model</span>
            <select
              className="field-select"
              value={status?.model ?? ""}
              disabled={busy}
              onChange={async (e) => {
                const model = e.target.value;
                setBusy(true);
                try {
                  await invoke("configure_local_ai", { model });
                  setStatus((s) => (s ? { ...s, model } : s));
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value="">Choose an installed local model</option>
              {status?.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Local AI is available in the desktop app.
        </p>
      )}
      <details className="rounded-lg border p-3 text-xs leading-relaxed">
        <summary className="cursor-pointer font-medium">
          Setup instructions
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-4">
          <li>
            Use Download & install above for task drafts, or install all options. Setup installs Ollama and downloads Qwen 3 4B without changing your task-model selection.
          </li>
          <li>
            Download Phonon 2 or Whisper above, select your speech model, then press Start local AI. The app starts local services and stops the ones it owns when you quit.
          </li>
          <li>
            Choose your task model above. Open My day to type or record a
            request and review the task drafts.
          </li>
        </ol>
        <p className="mt-3 text-muted-foreground">
          Automatic installation requires macOS and Homebrew.
        </p>
      </details>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
