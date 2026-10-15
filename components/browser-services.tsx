"use client";
import { useEffect } from "react";
import { isDesktop } from "@/lib/storage";
import { googleStatus, syncGoogle } from "@/lib/browser-google";
import { backupStatus, runBackup } from "@/lib/browser-backup";
/** One app-level timer; settings panels can unmount without stopping enabled services. */
export function BrowserServices() {
  useEffect(() => {
    if (isDesktop()) return;
    let busy = false,
      active = true;
    const tick = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        const g = await googleStatus();
        if (active && g.connected && g.automatic) await syncGoogle();
        if (active && (await backupStatus()).enabled) await runBackup();
      } catch {
        /* Service status surfaces retryable errors in Settings. */
      } finally {
        busy = false;
      }
    };
    const interval = setInterval(tick, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  return null;
}
