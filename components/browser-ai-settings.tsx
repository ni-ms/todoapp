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
        Choose how to create task drafts.
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
                Requests and selected context stay on this device. Start Ollama on your computer to connect.
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
                  {status.ollamaAvailable ? "connected" : "not connected"}
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
                Runs on this device. Downloads about 1 GB and requires a WebGPU-compatible GPU. Requests and selected context stay local.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await loadBrowserModel(setNotice);
                      setLoaded(true);
                      setNotice(
                        "Browser model ready.",
                      );
                    })
                  }
                >
                  {loaded ? "Model loaded" : "Load model"}
                </Button>
                {loaded && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await unloadBrowserModel();
                        setLoaded(false);
                        setNotice(
                          "Model unloaded. Download stays cached.",
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
                Creating drafts sends your request, selected context, and tag names to OpenRouter and its model provider.
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
                Free models have usage limits. Paid models charge your OpenRouter account; there’s no automatic paid fallback.
              </p>
              <label className="block space-y-2 text-xs">
                OpenRouter API key
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
                        "Settings saved. Key clears on reload.",
                      );
                    })
                  }
                >
                  Save settings
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
                Your key stays in this tab and clears on reload. Set a spending limit in OpenRouter.
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
      {settings?.provider === "ollama" && <details className="rounded-lg border p-3 text-xs leading-relaxed">
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
      </details>}
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Working…
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
