"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { BrowserSpeechSettings } from "./browser-speech-settings";
import { Input } from "./ui/input";
import {
  aiSettings,
  saveAISettings,
  localAIStatus,
  loadBrowserModel,
  unloadBrowserModel,
  browserModelLoaded,
  setHostedKey,
  hasHostedKey,
  type AISettings,
  type LocalAIStatus,
  type AIProvider,
} from "@/lib/ai";
export function BrowserAISettings() {
  const [settings, setSettings] = useState<AISettings | null>(null),
    [status, setStatus] = useState<LocalAIStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [key, setKey] = useState(""),
    [keyReady, setKeyReady] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    aiSettings()
      .then((s) => {
        if (active) {
          setSettings(s);
          setKeyReady(hasHostedKey());
          setLoaded(browserModelLoaded());
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function update(patch: Partial<AISettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    await saveAISettings(next);
    setSettings(next);
    setNotice("AI settings saved.");
  }
  return (
    <section className="surface space-y-4 p-6">
      <h2 className="text-sm font-semibold">AI</h2>
      <p className="text-sm text-muted-foreground">
        Choose where task requests are processed. Drafts always need your
        review. Scheduling works without AI.
      </p>
      {settings ? (
        <fieldset disabled={busy} className="space-y-4">
          <label className="block space-y-2 text-xs">
            AI provider
            <select
              aria-label="AI provider"
              className="field-select"
              value={settings.provider}
              onChange={(e) =>
                run(() => update({ provider: e.target.value as AIProvider }))
              }
            >
              <option value="ollama">Local Ollama</option>
              <option value="browser">On this device · browser model</option>
              <option value="openrouter">Hosted · OpenRouter</option>
            </select>
          </label>
          {settings.provider === "ollama" && (
            <>
              <p className="text-xs text-muted-foreground">
                Your request, selected excerpts, and tag names go to Ollama at
                127.0.0.1:11434. Start the server on your computer; a website
                cannot start or stop installed programs.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  run(async () => {
                    const s = await localAIStatus();
                    setStatus(s);
                    if (!s.ollamaAvailable)
                      throw new Error(
                        "Ollama is not reachable. Check the setup instructions below.",
                      );
                    setNotice("Ollama is connected.");
                  })
                }
              >
                Check local connection
              </Button>
              {status && (
                <p className="text-xs">
                  Ollama:{" "}
                  {status.ollamaAvailable ? "connected" : "not connected"} ·
                  Voice uses the browser speech model below
                </p>
              )}
              <label className="block space-y-2 text-xs">
                Task model
                <select
                  aria-label="Ollama task model"
                  className="field-select"
                  value={settings.model}
                  onChange={(e) => run(() => update({ model: e.target.value }))}
                >
                  <option value="">Choose an installed local model</option>
                  {settings.model &&
                    !status?.models.includes(settings.model) && (
                      <option>{settings.model}</option>
                    )}
                  {status?.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {settings.provider === "browser" && (
            <>
              <p className="text-xs text-muted-foreground">
                Qwen 2.5 1.5B runs on this device using WebGPU. Loading
                downloads model files from the model host and caches them in
                your browser (around 1 GB). Requests and excerpts stay on this
                device. Requires enough GPU memory; smaller models can make
                mistakes.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await loadBrowserModel(setNotice);
                      setLoaded(true);
                      setNotice(
                        "Browser model ready. Open My day to create task drafts.",
                      );
                    })
                  }
                >
                  {loaded ? "Model loaded" : "Download / load browser model"}
                </Button>
                {loaded && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await unloadBrowserModel();
                        setLoaded(false);
                        setNotice(
                          "Model unloaded from memory. Cached downloads remain in browser storage.",
                        );
                      })
                    }
                  >
                    Unload model
                  </Button>
                )}
              </div>
            </>
          )}
          {settings.provider === "openrouter" && (
            <>
              <p className="text-xs text-muted-foreground">
                When you create drafts, your request, checked file excerpts, and
                active tag names are sent to OpenRouter and its selected model
                provider. Nothing is sent merely by selecting this option. We
                request providers that disallow data collection.
              </p>
              <label className="block space-y-2 text-xs">
                Model ID
                <Input
                  aria-label="OpenRouter model"
                  value={settings.hostedModel}
                  maxLength={200}
                  onChange={(e) =>
                    setSettings({ ...settings, hostedModel: e.target.value })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground">
                The default openrouter/free router uses available free models;
                capacity and usage limits vary. Paid models charge your own
                provider account. There is no automatic fallback to a paid
                model.
              </p>
              <label className="block space-y-2 text-xs">
                Your OpenRouter key · this tab only
                <Input
                  aria-label="OpenRouter API key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    keyReady
                      ? "A key is set for this tab"
                      : "Paste your own limited-use API key"
                  }
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!key.trim() && !keyReady}
                  onClick={() =>
                    run(async () => {
                      await saveAISettings(settings);
                      if (key.trim()) {
                        setHostedKey(key);
                        setKey("");
                        setKeyReady(true);
                      }
                      setNotice(
                        "Hosted settings saved. Key stays in this tab’s memory and clears on reload.",
                      );
                    })
                  }
                >
                  Use hosted settings
                </Button>
                {keyReady && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setHostedKey("");
                      setKey("");
                      setKeyReady(false);
                    }}
                  >
                    Forget key
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Use a separate key with a small spending limit. The key is
                accessible to this page while in use; it is never saved in
                browser storage, exports, the source, or GitHub Actions.
              </p>
              <a
                className="text-xs underline"
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noreferrer"
              >
                OpenRouter keys and limits
              </a>
            </>
          )}
        </fieldset>
      ) : (
        <p className="text-xs">Loading AI settings…</p>
      )}
      <BrowserSpeechSettings />
      <details className="rounded-lg border p-3 text-xs leading-relaxed">
        <summary className="cursor-pointer font-medium">
          Local Ollama setup
        </summary>
        <p className="mt-3">
          For Ollama, allow only this website’s origin in OLLAMA_ORIGINS and
          start with OLLAMA_NO_CLOUD=1. Keep servers bound to 127.0.0.1. Reload
          the server after changing its configuration.
        </p>
        <p className="mt-2">
          Allowed origin for this tab:{" "}
          <code>
            {typeof window !== "undefined" ? window.location.origin : ""}
          </code>
          . Do not use a wildcard origin.
        </p>
      </details>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Working… Model downloads can take several minutes.
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
