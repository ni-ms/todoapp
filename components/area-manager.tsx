"use client";
import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TagPicker } from "@/components/tag-manager";
import { TagIcon } from "@/components/tag-icon";
import { areaTagIds, taskInArea } from "@/lib/areas";
import { colors, presetIcons, type Area, type AreaInput, type Tag, type Task } from "@/lib/domain";

export function AreaManager({ areas, tags, tasks, busy, onOpen, onSave, onArchive }: {
  areas: Area[]; tags: Tag[]; tasks: Task[]; busy: boolean;
  onOpen: (id: string) => void; onSave: (input: AreaInput) => Promise<void>; onArchive: (id: string) => void;
}) {
  const [editing, setEditing] = useState<AreaInput | null>(null);
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Create spaces using one or more tags. Tasks matching any selected tag appear here.</p>
      <Button disabled={busy} onClick={() => setEditing({ name: "", color: "violet", icon: "hash", tagIds: [] })}><Plus />New area</Button>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {areas.filter((area) => !area.deletedAt).map((area) => {
        const ids = areaTagIds(area, tags);
        return <section key={area.id} className={`surface area-${area.color} p-5`}>
          <div className="flex items-center gap-3">
            <TagIcon icon={area.icon} className="size-5 shrink-0" />
            <button className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-primary" aria-label={`Open area ${area.name}`} onClick={() => onOpen(area.id)}>{area.name}</button>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Edit area ${area.name}`} onClick={() => setEditing({ id: area.id, name: area.name, color: area.color, icon: area.icon, tagIds: area.tagIds })}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Archive area ${area.name}`} onClick={() => onArchive(area.id)}><Trash2 /></Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{tasks.filter((task) => !task.deletedAt && task.status !== "done" && taskInArea(task, ids)).length} active tasks</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{tags.filter((tag) => ids.includes(tag.id)).map((tag) => <span key={tag.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"><TagIcon icon={tag.icon} className="size-3" />{tag.name}</span>)}</div>
          {!ids.length && <p className="mt-3 text-xs text-muted-foreground">Choose active tags to show tasks in this area.</p>}
        </section>;
      })}
    </div>
    {!areas.some((area) => !area.deletedAt) && <p className="surface p-8 text-center text-sm text-muted-foreground">Create an area, then choose the tags it brings together.</p>}
    <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
      <DialogContent showCloseButton={!busy}>{editing && <AreaForm initial={editing} tags={tags} busy={busy} onCancel={() => setEditing(null)} onSave={async (input) => { await onSave(input); setEditing(null); }} />}</DialogContent>
    </Dialog>
  </>;
}
function AreaForm({ initial, tags, busy, onSave, onCancel }: { initial: AreaInput; tags: Tag[]; busy: boolean; onSave: (input: AreaInput) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try { await onSave(value); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <form onSubmit={submit} className="space-y-5">
    <DialogHeader><DialogTitle>{value.id ? "Edit area" : "New area"}</DialogTitle><DialogDescription>Give this space its own name and choose the tags it includes.</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="area-name">Area name</Label><Input id="area-name" required maxLength={200} autoFocus value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="e.g. University, Developer journey" /></div>
      <div className="space-y-2"><Label>Included tags</Label><TagPicker tags={tags} value={value.tagIds} onChange={(tagIds) => setValue({ ...value, tagIds })} /><p className="text-xs text-muted-foreground">Match any selected tag. Tags can belong to several areas.</p></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-2 text-sm">Icon<select className="field-select" aria-label="Area icon" value={value.icon} onChange={(e) => setValue({ ...value, icon: e.target.value })}>{!presetIcons.some((icon) => icon === value.icon) && <option value={value.icon}>Custom icon</option>}{presetIcons.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
        <label className="space-y-2 text-sm">Color<select className="field-select" aria-label="Area color" value={value.color} onChange={(e) => setValue({ ...value, color: e.target.value as AreaInput["color"] })}>{colors.map((color) => <option key={color} value={color}>{color}</option>)}</select></label>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button disabled={busy || !value.tagIds.length}>{busy ? "Saving…" : "Save area"}</Button></DialogFooter>
  </form>;
}
