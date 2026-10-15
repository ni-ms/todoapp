"use client";
import { useRef, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Upload, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { TagIcon } from "@/components/tag-icon";
import {
  colors,
  presetIcons,
  validateTag,
  type Tag,
  type TagInput,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
export function TagPicker({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div role="group" aria-label="Tags" className="flex flex-wrap gap-2">
      {tags
        .filter((t) => !t.deletedAt || value.includes(t.id))
        .map((tag) => (
          <button
            key={tag.id}
            type="button"
            aria-pressed={value.includes(tag.id)}
            onClick={() =>
              onChange(
                value.includes(tag.id)
                  ? value.filter((id) => id !== tag.id)
                  : [...value, tag.id],
              )
            }
            className={cn(
              `area-${tag.color} inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs`,
              value.includes(tag.id)
                ? "border-primary/40 bg-accent"
                : "hover:bg-muted",
            )}
          >
            <TagIcon icon={tag.icon} className="size-3.5" />
            {tag.name}
            {tag.deletedAt ? " (archived)" : ""}
          </button>
        ))}
      {!tags.length && (
        <p className="text-xs text-muted-foreground">
          Add tags from the Tags page.
        </p>
      )}
    </div>
  );
}
export function TagManager({
  tags,
  busy,
  onSave,
  onArchive,
  onRestore,
  onDelete,
}: {
  tags: Tag[];
  busy: boolean;
  onSave: (input: TagInput) => Promise<void>;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<TagInput | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [deleteError, setDeleteError] = useState("");
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your tags</h2>
        <Button
          onClick={() =>
            setEditing({ name: "", color: "violet", icon: "hash" })
          }
        >
          <Plus />
          New tag
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tags
          .filter((t) => !t.deletedAt)
          .map((tag) => (
            <div
              key={tag.id}
              className={`surface area-${tag.color} flex items-center gap-3 p-4`}
            >
              <span
                className="rounded-lg p-2.5"
                style={{
                  background: "var(--area-soft)",
                  color: "var(--area-color)",
                }}
              >
                <TagIcon icon={tag.icon} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {tag.name}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit tag ${tag.name}`}
                onClick={() =>
                  setEditing({
                    id: tag.id,
                    name: tag.name,
                    color: tag.color,
                    icon: tag.icon,
                  })
                }
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Archive tag ${tag.name}`}
                onClick={() => onArchive(tag.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
      </div>
      {tags.some((t) => t.deletedAt) && (
        <details className="mt-7">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Archived tags
          </summary>
          <div className="mt-3 space-y-2">
            {tags
              .filter((t) => t.deletedAt)
              .map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-2 text-sm"
                >
                  <span>{t.name}</span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRestore(t.id)}
                    >
                      <RotateCcw />
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Delete archived tag ${t.name}`}
                      onClick={() => {
                        setDeleting(t);
                        setDeleteError("");
                      }}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </details>
      )}
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
              This permanently deletes the tag and removes it from all tasks and
              events, including items in Trash. Your tasks and events will be
              kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              autoFocus
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
                  await onDelete(deleting.id);
                  setDeleting(null);
                } catch (error) {
                  setDeleteError(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          {editing && (
            <TagForm
              key={editing.id ?? "new"}
              initial={editing}
              busy={busy}
              onSave={async (value) => {
                await onSave(value);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function TagForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: TagInput;
  busy: boolean;
  onSave: (input: TagInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  async function read(file?: File) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 2 * 1024 * 1024
      )
        throw new Error("Choose a PNG, JPEG, or WebP image under 2 MB.");
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 4096 || bitmap.height > 4096) {
        bitmap.close();
        throw new Error("Use an image smaller than 4096 × 4096 pixels.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 96;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not read this image.");
      const ratio = Math.min(96 / bitmap.width, 96 / bitmap.height);
      const w = bitmap.width * ratio,
        h = bitmap.height * ratio;
      context.drawImage(bitmap, (96 - w) / 2, (96 - h) / 2, w, h);
      bitmap.close();
      const icon = canvas.toDataURL("image/png");
      if (icon.length > 90022) throw new Error("Try a simpler icon.");
      setValue((v) => ({ ...v, icon }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this image.");
    } finally {
      setReading(false);
      if (upload.current) upload.current.value = "";
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      validateTag(value);
      await onSave(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{value.id ? "Edit tag" : "New tag"}</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a name, color, and icon.
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={busy || reading} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="tag-name">Name</Label>
          <Input
            id="tag-name"
            required
            maxLength={40}
            autoFocus
            value={value.name}
            onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))}
            placeholder="e.g. Research, Fitness, Interviews"
          />
        </div>
        <div className="space-y-2">
          <Label>Icon</Label>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Preset icons"
          >
            {presetIcons.map((icon) => (
              <Button
                key={icon}
                variant={value.icon === icon ? "secondary" : "outline"}
                type="button"
                size="icon"
                aria-label={`Icon ${icon}`}
                aria-pressed={value.icon === icon}
                onClick={() => setValue((v) => ({ ...v, icon }))}
              >
                <TagIcon icon={icon} />
              </Button>
            ))}
          </div>
          <input
            ref={upload}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Upload tag icon"
            onChange={(e) => read(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            type="button"
            onClick={() => upload.current?.click()}
          >
            <Upload />
            {reading ? "Reading…" : "Upload icon"}
          </Button>
          {value.icon.startsWith("data:") && (
            <div className="inline-block rounded border p-2 align-middle">
              <TagIcon icon={value.icon} className="size-8" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Color</Label>
          <div className="flex gap-3" role="group" aria-label="Tag color">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                aria-pressed={value.color === color}
                className={cn(
                  `area-${color} size-8 rounded-full border-4 border-background`,
                  value.color === color && "ring-2 ring-primary",
                )}
                style={{ background: "var(--area-color)" }}
                onClick={() => setValue((v) => ({ ...v, color }))}
              />
            ))}
          </div>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy || reading}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy || reading}>
          {busy ? "Saving…" : "Save tag"}
        </Button>
      </DialogFooter>
    </form>
  );
}
