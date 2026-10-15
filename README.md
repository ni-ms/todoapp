# Daymark · Learning workspace

A local desktop planner for students and independent learners who also build things. Keep coursework, coding projects, and career preparation together without turning every goal into a separate app.

Built with Tauri 2, Rust, Next.js 16 static export, React 19, TypeScript, Tailwind CSS 4, and shadcn/ui with Radix primitives. The desktop app embeds static assets; it does not run a Next.js server.

## What works

- Calendar opens in Week view, with Day/Month options, tag filtering, timed/all-day events, task links, drag/resize, and ICS export.
- One tag system for courses, coding projects, career goals, and general labels. Existing courses/projects are migrated to tags with names, notes, short labels, type, timestamps, Trash state, and task assignments preserved. Tasks can have multiple tags. Areas are independent named spaces associated with one or more tags. A task matching any associated active tag appears in the area; tags can be shared across areas. Creating or renaming tags does not create or rename areas. Existing tag spaces are copied once by migration 5.
- My Day centers on task capture, today's schedule, and due/in-progress work. Its Area dropdown filters tasks and events (including sessions linked to tagged tasks); new manual and AI-drafted tasks default to the first active tag of the selected area (editable before saving). The weekly planner continues to plan across all areas. Undated backlog items stay in Tasks unless in progress or scheduled today. Search, status/tag filters, completion/reopening, and light/dark/system themes remain available.
- Local voice/text capture with Ollama and whisper.cpp: attach selected text/code files or folders, review excerpts and transcript, edit task drafts, and save an atomic batch. See [local AI setup](docs/local-ai.md). No hosted AI account/API key is needed for local capture.
- Local weekly planning previews with study hours, weekend/break options, deadlines, priorities, busy-time avoidance, split sessions, unscheduled-work explanations, stale-preview protection, and guarded undo.
- Recoverable Trash for tasks, events, and tags (including course/project tags), plus confirmed permanent deletion. Removing a task keeps its calendar events, detached from the task. Removing a course/tag keeps tasks and events and removes assignments.
- Desktop SQLite persistence, isolated browser IndexedDB workspace, accessible dialogs, responsive navigation, and keyboard shortcuts (`N`, `Cmd/Ctrl+K` for visible search).
- JSON workspace export and ICS export. Optional Google OAuth publishes to a dedicated calendar and backs up to Drive; a user-chosen cloud-folder alternative writes atomic JSON/ICS backups. Both run while the app is open. See [Google setup](docs/google-setup.md).

Continuous automatic rescheduling, recurring habits/focus agents, two-way calendar sync, imported external busy time, PDF/Office context, multi-device merging, JSON import/restore, and learning recommendations are not implemented. Planning is currently on demand. Google live account sync is still unverified. Local Qwen inference and Whisper transcription have been tested with sample inputs; the user microphone permission/device flow needs a manual check.

The browser app now supports weekly planning, AI provider choices, file context, Google publishing/Drive backup, and supported-browser folder backup; see [browser setup and verification limits](docs/browser.md). Desktop Rust and browser adapters retain separate persistence and credentials.

See [Reclaim review and scope](docs/reclaim-review.md) for the current feature comparison.

## Requirements and development

Use Node.js 24 LTS (`.nvmrc`; declared minimum 22), npm, Rust 1.90 or newer, and the platform dependencies in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode Command Line Tools.

```sh
npm ci
npm run tauri dev
```

For browser-only development:

```sh
npm run dev
```

Open http://127.0.0.1:3000. **Browser preview stores its data separately in IndexedDB**, with an explanation in Settings. It never substitutes for a failed native database. An empty preview can load an optional example workspace. Clearing site data removes preview records; exporting them first preserves a copy. Preview records are not automatically transferred to the desktop database.

## GitHub Pages browser preview

The app can be hosted as a static website: Next.js exports HTML, CSS, and JavaScript to `out/`. No backend or Rust/WASM build is needed for the existing browser preview. Tasks, tags, areas, and calendar events persist locally in each visitor's browser; hosting does not upload their workspace or share it across devices. The browser has its own deterministic weekly planner, a local Ollama adapter and on-device speech, optional WebLLM in-browser task generation, optional OpenRouter hosted task generation, Google web sign-in/publishing/Drive backup, and folder backup in supported browsers. See [browser setup and limits](docs/browser.md). Browser voice uses a separately loaded on-device Whisper Tiny model with WebAssembly; no local speech server is required.

To publish:

1. In the GitHub repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source.
2. Merge/push this workflow and app changes to `main`. Subsequent pushes to `main` automatically test, build, and deploy. You can also run **Deploy browser preview to GitHub Pages** from the Actions tab, selecting `main`.
3. Open the URL shown in the deployment's `github-pages` environment (normally https://ni-ms.github.io/todoapp/ for this repository).

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) uses the standard repository token; no personal access token or additional secret is needed. The Pages configuration supplies `PAGES_BASE_PATH` at build time, supporting repository paths and custom domains. Ordinary desktop/local builds keep the root path. Pages availability depends on your repository visibility and GitHub plan; the workflow does not change either setting.

To preview the repository path locally:

```sh
PAGES_BASE_PATH=/todoapp npm run build
mkdir -p /tmp/daymark-pages-preview/todoapp
cp -R out/. /tmp/daymark-pages-preview/todoapp/
python3 -m http.server 4173 --bind 127.0.0.1 --directory /tmp/daymark-pages-preview
```

Open http://127.0.0.1:4173/todoapp/. Rebuild without `PAGES_BASE_PATH` before packaging the desktop app.

## Data and architecture

- `components/learner-workspace.tsx`: application shell and views.
- `components/workspace-forms.tsx`, `components/ui/`: typed forms and owned shadcn/ui component source.
- `lib/domain.ts`: shared frontend records and validation.
- `lib/storage.ts`: native command adapter and isolated browser IndexedDB adapter, including atomic browser planning transactions.
- `lib/planning.ts`, `lib/ai.ts`, `lib/ai-worker.ts`: browser scheduling and explicit AI provider adapters.
- `lib/browser-google.ts`, `lib/browser-backup.ts`, `components/browser-services.tsx`: opt-in browser Google/folder backups and app-level service timer.
- `src-tauri/src/workspace.rs`: authoritative validation, SQLite queries, and persistence tests.
- `components/calendar-view.tsx`, `components/event-form.tsx`, `components/tag-manager.tsx`: calendar planning and custom tags.
- `lib/ical.ts`, `src-tauri/src/ical.rs`: RFC 5545 calendar exports with UTF-8 folding and exclusive all-day ends.
- `src-tauri/src/calendar.rs`: authoritative event and tag validation/persistence.
- `src-tauri/src/google.rs`: native OAuth, calendar publishing, and Drive backup; credentials stay in the OS credential store.
- `src-tauri/src/backup.rs`: atomic cloud-folder backups.
- `src-tauri/src/local_ai.rs`: bounded selected-file context, local model connections, validated drafts, and app-managed local processes.
- `src-tauri/src/planner.rs`: deterministic scheduling, preview/apply, and guarded undo.
- `src-tauri/src/trash.rs`: atomic permanent deletion and batch task creation.
- `components/task-capture.tsx`, `components/planner.tsx`, `components/trash-view.tsx`: the associated review and confirmation workflows.
- `src-tauri/migrations/`: migrations through schema version 5, run transactionally using `PRAGMA user_version`. Version 4 consolidates courses/projects into tags without losing metadata or assignments; version 5 adds independent areas with tag associations.
- `src-tauri/src/main.rs`: typed commands executed on blocking workers with serialized database access.
- `src-tauri/capabilities/workspace.json`: main-window permissions for workspace commands; no arbitrary SQL or filesystem API is exposed.

The SQLite database is `learner.sqlite3` in Tauri's application data directory. On macOS this is `~/Library/Application Support/com.nikms.todoapp/`. WAL mode, foreign keys, and a busy timeout are enabled. The app refuses to open newer database schemas rather than downgrading them. The database is local but **not encrypted**; standard OS account and disk protections apply.

The identifier remains `com.nikms.todoapp` to preserve app identity and storage paths. The UI uses Daymark as a working name. Prototype task records from the previous in-memory interface were not durable and cannot be recovered after their session ends. Older todo components and Rust `todo_utils` models remain as legacy code; the new SQLite records are the active model.

No analytics is connected. Desktop local inference uses fixed loopback endpoints. Browser users explicitly choose local Ollama, an in-browser model, or OpenRouter with their own memory-only API key; no hosted account/key is bundled. Google network access happens only after sign-in, through native Rust on desktop or Google Identity Services/REST in the browser. The desktop frontend CSP permits bundled assets and local IPC; development additionally permits the Next.js local development server. Backups do not contain OAuth tokens. Disconnect stops future uploads and preserves provider data. Read [the setup guide](docs/google-setup.md) before enabling uploads.

## Checks and builds

```sh
npm test
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build -- --debug --no-bundle
```

`npm run check` runs ESLint, TypeScript, and a static production build. Tests cover persistence, version-one upgrades, idempotent migrations, rejecting newer schemas, invalid dates/zones/icons, recoverable deletion, atomic backups, DST and ICS escaping/folding, OAuth state/PKCE, and safe retry comparison when Google normalizes timestamps. Browser and packaged macOS checks verify user workflows and persistence. Windows and Linux runtime behavior has not been verified in this workspace.

To create a local macOS app bundle, use `npm run tauri build -- --debug --bundles app`. For release installers, run `npm run tauri build`; outputs appear under `src-tauri/target/release/`. Signing and distribution require separate configuration. If this environment prevents Turbopack from binding its local build-worker port, verify with the supported Webpack alternative: `npm run tauri build -- --debug --bundles app --config '{"build":{"beforeBuildCommand":"npm run build -- --webpack"}}'`. This override does not change the normal build configuration.

`next start` does not serve a static export. Preview `out/` using a static server, for example `python3 -m http.server 4173 --directory out`.

The current full npm audit reports five high-severity findings in the development-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` chain. The earlier compatible refresh left these upstream findings unresolved; recheck before release. Avoid the suggested forced downgrade. ESLint stays on 9 to match the peer ranges declared by Next's React/import/accessibility plugins. Legacy Rust model code still emits dead-code warnings.

See [AGENTS.md](AGENTS.md) for product direction, implementation conventions, and the staged plan toward learning-aware scheduling.
