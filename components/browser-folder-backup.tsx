"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  backupStatus,
  backupHandle,
  chooseBackup,
  grantBackupPermission,
  disableBackup,
  runBackup,
  type BackupStatus,
} from "@/lib/browser-backup";
export function BrowserFolderBackup({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<BackupStatus | null>(null),
    [busy, setBusy] = useState(false),
    [handle, setHandle] = useState<Awaited<ReturnType<typeof backupHandle>>>();
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const [s, h] = await Promise.all([backupStatus(), backupHandle()]);
        if (active) {
          setStatus(s);
          setHandle(h);
        }
      } catch (e) {
        if (active) onError(String(e));
      }
    };
    void read();
    const interval = setInterval(read, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onError]);
  async function run(action: () => Promise<BackupStatus>) {
    setBusy(true);
    try {
      const s = await action();
      setStatus(s);
      setHandle(await backupHandle());
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 space-y-3 text-xs">
      {status?.supported ? (
        <>
          <p>
            {status.enabled
              ? `Automatic backup is on · ${status.folder}`
              : "No backup folder connected"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(chooseBackup)}
            >
              {status.folder ? "Change folder" : "Choose folder"}
            </Button>
            {status.enabled && (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(runBackup)}
                >
                  Back up now
                </Button>
                {handle && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => run(() => grantBackupPermission(handle))}
                  >
                    Allow folder access
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(disableBackup)}
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>
          {status.lastBackup && (
            <p>Last backup: {new Date(status.lastBackup).toLocaleString()}</p>
          )}
          {status.error && (
            <p role="alert" className="text-destructive">
              {status.error}
            </p>
          )}
          <p className="text-muted-foreground">
            Writes JSON and ICS files only inside Daymark backups in your chosen
            folder. Each file replaces its previous version on close. Runs
            approximately once a minute while this tab is open; background
            throttling and permission expiry can delay backups.
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">
          This browser does not support writing to a chosen folder. Use Chrome
          or Edge for automatic folder backups, or download JSON and ICS above.
        </p>
      )}
    </div>
  );
}
