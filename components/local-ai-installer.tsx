"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, LoaderCircle, Check } from "lucide-react";
import { Button } from "./ui/button";
interface SetupStatus {
  progress: { busy: boolean; message: string; error: string };
  supported: boolean;
  packageManager: boolean;
  ollama: boolean;
  phonon: boolean;
  whisper: boolean;
}
const options = [
  { id: "ollama", title: "Task drafts · Ollama + Qwen 3 4B", description: "About 2.5 GB + runtime." },
  { id: "phonon-2", title: "Voice · Phonon 2", description: "English · about 164 MB + runtime." },
  { id: "whisper", title: "Voice · Whisper base.en", description: "English · about 148 MB + runtime." },
] as const;
export function LocalAIInstaller({ onBusyChange, refresh, taskModelInstalled }: { onBusyChange: (busy: boolean) => void; refresh: () => void; taskModelInstalled: boolean }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let wasBusy = false;
    const check = async () => {
      try {
        const next = await invoke<SetupStatus>("local_ai_setup_status");
        if (!active) return;
        setStatus(next);
        onBusyChange(next.progress.busy);
        if (wasBusy && !next.progress.busy) refresh();
        wasBusy = next.progress.busy;
      } catch (e) { if (active) setError(String(e)); }
    };
    void check();
    const timer = setInterval(() => void check(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [onBusyChange, refresh]);
  async function install(packageId: string) {
    setRequestBusy(true); setError(""); onBusyChange(true);
    try {
      await invoke("install_local_ai", { package: packageId });
      setStatus(await invoke<SetupStatus>("local_ai_setup_status"));
    } catch (e) { setError(String(e)); onBusyChange(false); }
    finally { setRequestBusy(false); }
  }
  const busy = requestBusy || Boolean(status?.progress.busy);
  return <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Download local AI</h3>
        <p className="max-w-xl text-xs text-muted-foreground">Install once to use offline. Allow several GB of free space.</p>
      </div>
      <Button size="sm" disabled={busy || !status?.supported} onClick={() => void install("all")}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
        Install all
      </Button>
    </div>
    {status && !status.supported && <p className="text-xs text-muted-foreground">Automatic installation is available on macOS.</p>}
    {status?.supported && !status.packageManager && <p className="text-xs text-muted-foreground">{<>This installer needs <a className="underline" href="https://brew.sh" target="_blank" rel="noreferrer">Homebrew</a> once to manage runtimes. Install it, then retry here.</>}</p>}
    <div className="divide-y rounded-lg border bg-background">
      {options.map(option => {
        const installed = option.id === "ollama" ? status?.ollama : option.id === "phonon-2" ? status?.phonon : status?.whisper;
        return <div key={option.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium">{option.title}</p>
            <p className="text-xs text-muted-foreground">{option.description}</p>
            {installed && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />{option.id === "ollama" && !taskModelInstalled ? "Runtime installed · task model download available" : "Installed"}</p>}
          </div>
          <Button variant="outline" size="sm" disabled={busy || !status?.supported} onClick={() => void install(option.id)}>{option.id === "ollama" && installed && !taskModelInstalled ? "Download task model" : installed ? "Check / repair" : "Download & install"}</Button>
        </div>;
      })}
    </div>
    {status?.progress.message && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{status.progress.message}</p>}
    {busy && <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="ghost" onClick={async () => { try { await invoke("cancel_local_ai_install"); } catch (e) { setError(String(e)); } }}>Cancel installation</Button>
      <p className="text-xs text-muted-foreground">You can leave Settings while this runs. Keep Daymark open.</p>
    </div>}
    {(error || status?.progress.error) && <p role="alert" className="text-xs text-destructive">{error || status?.progress.error}</p>}
    <p className="text-xs text-muted-foreground">Phonon 2 weights: <a className="underline" href="https://huggingface.co/FermionResearch/Phonon-2" target="_blank" rel="noreferrer">Fermion Research · CC BY 4.0</a>.</p>
  </div>;
}
