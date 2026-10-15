"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { isDesktop } from "@/lib/storage";
import {
  duration,
  localDate,
  type Workspace,
  type EventInput,
} from "@/lib/domain";
interface Proposal {
  id: string;
  events: EventInput[];
  unscheduled: { title: string; minutes: number; reason: string }[];
}
export function Planner({
  onApply,
}: {
  onApply: (w: Workspace, notice: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [start, setStart] = useState(9),
    [end, setEnd] = useState(17),
    [breaks, setBreaks] = useState(10),
    [weekends, setWeekends] = useState(false),
    [undoable, setUndoable] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    invoke<boolean>("plan_undo_available")
      .then((value) => {
        if (active) setUndoable(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function preview() {
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      setProposal(
        await invoke<Proposal>("preview_plan", {
          options: {
            startDate: localDate(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            startHour: start,
            endHour: end,
            weekends,
            breakMinutes: breaks,
          },
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={!isDesktop()}
          onClick={() => {
            setOpen(true);
            setProposal(null);
            setError("");
          }}
        >
          Plan my week
        </Button>
        <p className="text-xs text-muted-foreground">
          Plan across all areas around your existing events.
        </p>
        {undoable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                onApply(
                  await invoke<Workspace>("undo_plan"),
                  "Plan undone. Sessions moved to Trash.",
                );
                setUndoable(false);
              } catch (e) {
                setError(String(e));
                setOpen(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            Undo last plan
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>Plan my week</DialogTitle>
            <DialogDescription>
              Preview sessions across all areas for the next seven days. Existing events stay
              fixed. Tasks are planned by deadline, then priority, in blocks up
              to 90 minutes.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={busy} className="grid grid-cols-3 gap-3">
            <label className="space-y-2 text-xs">
              Start
              <select
                aria-label="Study start hour"
                className="field-select"
                value={start}
                onChange={(e) => {
                  setStart(Number(e.target.value));
                  setProposal(null);
                }}
              >
                {Array.from({ length: 23 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-xs">
              End
              <select
                aria-label="Study end hour"
                className="field-select"
                value={end}
                onChange={(e) => {
                  setEnd(Number(e.target.value));
                  setProposal(null);
                }}
              >
                {Array.from({ length: 23 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {String(i + 1).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-xs">
              Breaks
              <select
                aria-label="Break minutes"
                className="field-select"
                value={breaks}
                onChange={(e) => {
                  setBreaks(Number(e.target.value));
                  setProposal(null);
                }}
              >
                {[0, 5, 10, 15, 30].map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={weekends}
                onChange={(e) => {
                  setWeekends(e.target.checked);
                  setProposal(null);
                }}
              />
              Include weekends
            </label>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Uses events in this app. Other Google calendar commitments are not
            imported yet; add them here before planning. All-day events block
            the whole day.
          </p>
          <Button
            variant="outline"
            disabled={busy || start >= end}
            onClick={preview}
          >
            {busy ? "Planning…" : "Preview plan"}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {proposal && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">
                {proposal.events.length} sessions proposed
              </h3>
              <ul className="max-h-56 space-y-2 overflow-auto">
                {proposal.events.map((event, i) => (
                  <li key={i} className="rounded border p-3 text-xs">
                    <p className="font-medium">{event.title}</p>
                    <p className="mt-1 text-muted-foreground">
                      {new Date(event.start).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {new Date(event.end).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </li>
                ))}
              </ul>
              {proposal.unscheduled.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <h3 className="mb-2 text-xs font-semibold">
                    Work that doesn’t fit
                  </h3>
                  {proposal.unscheduled.map((t, i) => (
                    <p key={i} className="mb-2 text-xs">
                      {t.title}: {duration(t.minutes)} unscheduled. {t.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !proposal?.events.length}
              onClick={async () => {
                if (!proposal) return;
                setBusy(true);
                setError("");
                try {
                  onApply(
                    await invoke<Workspace>("apply_plan", { id: proposal.id }),
                    "Study sessions added to your calendar.",
                  );
                  setUndoable(true);
                  setOpen(false);
                  setProposal(null);
                } catch (e) {
                  setError(String(e));
                  setProposal(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add sessions to calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
