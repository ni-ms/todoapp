"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  prepareGoogle,
  googlePrepared,
  configureGoogle,
  googleClientId,
  googleStatus,
  connectGoogle,
  disconnectGoogle,
  automaticGoogle,
  syncGoogle,
  type GoogleStatus,
} from "@/lib/browser-google";
export function BrowserGoogleConnection({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [id, setId] = useState(""),
    [status, setStatus] = useState<GoogleStatus | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const read = () =>
      googleStatus()
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch((e) => {
          if (active) onError(String(e));
        });
    googleClientId()
      .then((s) => {
        if (active) {
          setId(s);
          setReady(googlePrepared());
        }
      })
      .catch((e) => onError(String(e)));
    void read();
    const interval = setInterval(read, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onError]);
  async function run(action: () => Promise<GoogleStatus | void>) {
    setBusy(true);
    try {
      const s = await action();
      setStatus(s ?? (await googleStatus()));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface space-y-4 p-6">
      <h2 className="text-sm font-semibold">Google</h2>
      <p className="text-sm text-muted-foreground">
        Publish events and open task deadlines to a dedicated Google Calendar.
        Back up your entire workspace, including Trash, to Drive’s private
        app-data folder.
      </p>
      {!status?.connected && (
        <>
          <label className="block space-y-2 text-xs">
            Google Web client ID
            <Input
              aria-label="Google Web client ID"
              value={id}
              disabled={busy}
              maxLength={256}
              onChange={(e) => {
                setId(e.target.value);
                setReady(false);
              }}
              placeholder="…apps.googleusercontent.com"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !id.trim()}
              onClick={() =>
                run(async () => {
                  await configureGoogle(id.trim());
                  await prepareGoogle();
                  setReady(true);
                })
              }
            >
              Save setup / load sign-in
            </Button>
            <Button
              disabled={busy || !ready || !status?.configured}
              onClick={() => run(() => connectGoogle(id.trim()))}
            >
              Sign in with Google
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use a Web application OAuth client, enable Calendar/Drive APIs, and
            register this website’s origin in Authorized JavaScript origins. No
            client secret belongs in the website. A desktop OAuth JSON file does
            not work here.
          </p>
        </>
      )}
      {status?.connected && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(syncGoogle)}
            >
              {busy ? "Working…" : "Publish and back up now"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(disconnectGoogle)}
            >
              Disconnect
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={status.automatic}
              disabled={busy}
              onChange={(e) => run(() => automaticGoogle(e.target.checked))}
            />
            Publish and back up automatically while this tab is open
          </label>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Google access stays in this tab’s memory. Sign in again after reloading
        or when access expires. Automatic uploads run approximately once a
        minute while access is valid; browser background throttling can delay
        them. Disconnect stops future uploads and leaves Google copies intact.
      </p>
      <p className="text-xs text-muted-foreground">
        Publishing is one way. Google edits are not imported; conflicting remote
        edits are left unchanged. This connection does not read your other
        calendars or merge workspaces.
      </p>
      {status?.lastSync && (
        <p className="text-xs">
          Last published: {new Date(status.lastSync).toLocaleString()}
        </p>
      )}
      {status?.error && (
        <p role="alert" className="text-sm text-destructive">
          {status.error}
        </p>
      )}
    </section>
  );
}
