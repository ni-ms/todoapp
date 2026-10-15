"use client";
import { useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Workspace } from "@/lib/domain";
import type { TrashEntity } from "@/lib/organization";
export function TrashView({
  workspace,
  busy,
  onRestore,
  onDelete,
}: {
  workspace: Workspace;
  busy: boolean;
  onRestore: (entity: TrashEntity, id: string) => Promise<void>;
  onDelete: (entity: TrashEntity, id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<{
      entity: TrashEntity;
      id: string;
      name: string;
    } | null>(null),
    [error, setError] = useState("");
  const rows = [
    ...workspace.areas.filter((a) => a.deletedAt).map((a) => ({ entity: "area" as const, id: a.id, name: a.name, label: "Area" })),
    ...workspace.tasks
      .filter((t) => t.deletedAt)
      .map((t) => ({
        entity: "task" as const,
        id: t.id,
        name: t.title,
        label: "Task",
      })),
    ...workspace.events
      .filter((e) => e.deletedAt)
      .map((e) => ({
        entity: "event" as const,
        id: e.id,
        name: e.title,
        label: "Event",
      })),
    ...workspace.tags
      .filter((t) => t.deletedAt)
      .map((t) => ({
        entity: "tag" as const,
        id: t.id,
        name: t.name,
        label:
          t.kind === "course"
            ? "Course tag"
            : t.kind === "project"
              ? "Project tag"
              : "Tag",
      })),
    ...workspace.courses
      .filter((c) => c.deletedAt)
      .map((c) => ({
        entity: "course" as const,
        id: c.id,
        name: c.name,
        label: "Course",
      })),
  ];
  return (
    <>
      {error && !deleting && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <section className="surface divide-y">
        {rows.length ? (
          rows.map((row) => (
            <div
              key={row.entity + row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div>
                <p className="text-sm font-medium">{row.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.label}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setError("");
                    try {
                      await onRestore(row.entity, row.id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  aria-label={`Restore ${row.name}`}
                >
                  <RotateCcw />
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Permanently delete ${row.name}`}
                  onClick={() => {
                    setDeleting(row);
                    setError("");
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Trash is empty.
          </p>
        )}
      </section>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes this{" "}
              {deleting?.entity === "tag"
                ? "tag and removes its assignments"
                : deleting?.entity}
              . Related tasks and calendar events will be kept. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              autoFocus
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                try {
                  await onDelete(deleting.entity, deleting.id);
                  setDeleting(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
