# Project guidance

## Product direction

- Build a desktop and static browser planning app for **students and independent learners**, including learners preparing for programming and technology careers.
- The user wants automatic AI scheduling inspired by Reclaim.ai and a polished, modern UI using shadcn/ui.
- Treat adaptive scheduling as a baseline feature. Seek differentiation through useful learning outcomes, trustworthy planning, and a workflow tailored to learners.
- Proposed differentiator, still to validate: **learning-aware scheduling** that connects deadlines, topic prerequisites, spaced review, and learner feedback to a realistic daily study plan.
- Do not describe proposed features as implemented or claim a defensible moat without evidence. Separate confirmed user requirements, product hypotheses, and implementation status.

## Current implementation

- Tauri 2 desktop shell with Rust; Next.js 16 static export; React 19; TypeScript; Tailwind CSS 4; npm.
- `app/` contains routes and global styles. `components/` contains the current prototype UI. `src-tauri/` contains the desktop configuration and Rust models.
- Next.js exports to `out/`, which Tauri embeds. Preserve static-export compatibility: no reliance on Server Actions, API routes, or a running Next.js server inside the desktop app.
- The active interface is `components/learner-workspace.tsx`, using shadcn/ui primitives in `components/ui/`, shared form components, and the typed model in `lib/domain.ts`.
- Desktop tasks and work areas persist in SQLite through `src-tauri/src/workspace.rs` and narrowly scoped Tauri commands. `src-tauri/migrations/` contains transactional schema migrations through version 5, including tags, calendar events, preferences, and Google event state. Version 4 converts courses/projects/career goals to tags, preserving metadata and assignments. The old courses table/commands remain only for compatibility; Areas are independent saved spaces with their own name, icon, color, and one or more associated tags (schema 5). Match tasks/events with ANY active associated tag; multiple areas can share tags. Tags never automatically create, rename, or archive areas. Migration 5 copies previously visible tag spaces once for continuity. Do not restore the legacy courses model or fixed course/project/career divisions.
- The browser app explicitly uses separate IndexedDB storage through `lib/storage.ts`; it is not a fallback for failed desktop SQLite access. It can load optional example records only when empty.
- Existing `todo_utils` models and the older todo components are legacy prototype code, not the active persistence model.
- The calendar is the default view: FullCalendar 7 weekly time grid, day/month selection, timed/all-day events, drag/resizing, task deadlines, and ICS export. Tasks and scheduled events are separate records. Custom tags support preset icons and normalized uploaded PNG icons. Archived tags can be permanently deleted with confirmation; atomically remove their assignments from tasks/events, including Trash, while retaining those records.
- Optional native Google OAuth publishes to a dedicated app-created calendar and backs up to Drive app-data. `src-tauri/src/google.rs` owns provider calls, PKCE/loopback sign-in, OS credential storage, event IDs, revisions, and ETags. Publishing is one way; remote edits are not imported. Do not claim live Google sync is verified without an account-level test.
- `src-tauri/src/backup.rs` supports atomic JSON/ICS backups to a user-chosen local cloud folder. Both backup modes run only while the desktop app is open, approximately once a minute, and do not merge workspaces.
- My Day now contains local task capture, a schedule, and due/in-progress tasks. Undated backlog is shown under Tasks unless in progress or scheduled today. My Day has an area dropdown that scopes tasks, the agenda, and defaults for new tasks. Keep the My Day title visible. Areas and tags are separate records; area membership is computed from associated tags. New tasks default to the first active associated tag, editable before saving. The weekly planner explicitly plans across all areas.
- `src-tauri/src/local_ai.rs` implements fixed-loopback Ollama/Whisper inference, explicit file/folder excerpts, structured draft validation, and app-managed server lifecycles. Native inference remains local-only. Browser `lib/ai.ts` offers explicit local Ollama, WebLLM in-browser text inference, or user-owned OpenRouter hosted text inference; hosted keys remain in tab memory and no developer key/account is bundled. Never silently switch providers. Keep local cloud aliases rejected, native proxies disabled, redirects rejected, files bounded and selected explicitly, and model output unable to execute tools. Browser requests obey OS/browser networking policy and cannot disable proxies. Browser speech currently requires local Whisper for every text-provider choice. See `docs/browser.md` for data disclosure and setup.
- `src-tauri/src/planner.rs` implements on-demand seven-day planning, availability/breaks, busy-time avoidance, effort/deadline/priority allocation, preview fingerprints, atomic apply, and guarded undo. Existing sessions stay fixed. `lib/planning.ts` is the browser counterpart, with atomic IndexedDB apply/history and guarded undo. Browser Google token access stays in tab memory (`lib/browser-google.ts`), requires sign-in after reload/expiry, and uses account/client-scoped IDs, ETags, and Web Locks; live Google account verification remains outstanding. Browser folder backup (`lib/browser-backup.ts`) uses explicitly granted File System Access handles, with per-file replacement and permission-aware background ticks while the tab is open. Continuous automatic rescheduling, imported external busy time, recurring habits, bidirectional sync, and import/restore are not implemented.
- `src-tauri/src/trash.rs` adds confirmed permanent deletion and atomic task batches. Deleting an area preserves all tags, tasks, and events. Deleting a tag removes its area associations as well as task/event assignments; deleting a task detaches calendar events; deleting a course/tag detaches assignments without deleting tasks/events. See `docs/local-ai.md`, `docs/reclaim-review.md`, and `docs/google-setup.md` for scope and verification limits.

## Intended user experience

- Center the app on Today, a weekly calendar, a task/study backlog, courses or learning goals, and a clear planning review.
- Keep implementation details such as SQLite and persistence out of routine product screens. Put necessary storage and integration explanations in Settings or developer documentation.
- Support keyboard navigation, visible focus, accessible dialogs, responsive layouts, readable light/dark themes, and meaningful empty/loading/error states.
- Adopt shadcn/ui components incrementally, stored in `components/ui/`, with shared design tokens and reusable app components. Avoid duplicating custom controls when a suitable accessible primitive exists.
- A polished UI requires deliberate typography, spacing, hierarchy, and interactions; installing a component library alone does not complete a redesign.
- Let learners override estimates, priorities, study preferences, and inferred difficulty. Explain conflicts and missed deadlines without punitive language or manipulative engagement mechanics.

## Architecture direction

- Keep Tauri, React, TypeScript, and Tailwind. Add shadcn/ui as the UI foundation. Do not replace the framework or package manager solely for novelty.
- Use `rusqlite` with bundled SQLite behind typed Rust commands. The connection is serialized through a mutex and operations run on a blocking worker. Maintain versioned, transactional migrations; refuse newer schemas without altering them. Extend this model for study sessions and scheduling history when those features land.
- Put authoritative validation, persistence, and scheduling rules behind a small typed Rust command boundary. Keep the scheduling engine independent of Tauri so it can be tested without a desktop runtime.
- Keep React state for transient UI. Avoid multiple competing sources of truth for persisted records. Introduce additional state/query/form libraries only when a concrete workflow benefits from them.
- Separate task definitions, external calendar events, planned time blocks, and completed sessions. Rescheduling a block must not erase its source task or completion history.
- Isolate calendar providers and AI providers behind adapters. Core task management and deterministic scheduling should work offline; network-dependent features should show their availability clearly.
- Keep browser preview useful through an explicit development adapter when native services are unavailable. Do not silently present in-memory demo data as durable storage.

## Scheduling requirements

- Build a deterministic, testable constraint scheduler first. Use AI for natural-language capture, proposed task breakdowns, estimate suggestions, and explanations; validate all structured AI output before applying it.
- Model duration estimates, remaining effort, deadlines, earliest start, priorities, dependencies, working/study hours, breaks, minimum session sizes, and whether a task can be split.
- Distinguish hard constraints from preferences. Respect fixed events, locked blocks, dependencies, and explicit user edits. Prefer fewer unnecessary schedule changes.
- When work cannot fit, report unscheduled work and deadline risk with actionable tradeoffs. Never hide impossible workloads by overlapping commitments or silently extending availability.
- Store instants consistently and retain IANA time zones for local scheduling rules. Handle daylight-saving transitions, all-day events, recurrence, and travel explicitly.
- Every planning run should produce a reviewable set of changes and reasons. Support undo and predictable automation settings; avoid requiring confirmation for every routine replan once the user has enabled it.
- Calendar synchronization must be idempotent, track provider IDs and app-owned events, handle retries/conflicts, and avoid modifying unrelated commitments.

## Learning-aware scheduling hypothesis

- Start with manually entered courses/goals, assessments, topics, prerequisites, and estimated study effort before adding syllabus extraction or LMS integrations.
- Use upcoming assessments and topic dependencies to distribute study sessions across available time, with room for review and recovery after missed sessions.
- Capture lightweight, optional feedback: actual duration, session completion, retrieval confidence, and difficulties. Treat confidence as self-report, not objective mastery.
- Explore spaced retrieval and interleaved practice through explicit, testable rules. Keep learning recommendations explainable and editable.
- Evaluate whether personalization improves estimate accuracy, completion, and delayed recall. Do not optimize solely for calendar occupancy or time spent in the app.
- A potential moat is the longitudinal relationship between learning goals, planned work, actual effort, and learning feedback, combined with a useful student workflow. This is a product hypothesis, not an established competitive advantage.

## Delivery sequence

1. Establish a coherent shadcn/ui app shell, typed domain model, and durable local task/course CRUD; remove misleading placeholder actions as their replacements land.
2. Implement local scheduling with duration, deadlines, availability, locked blocks, explanations, undo, and conflict tests.
3. Integrate one calendar provider with explicit ownership rules and reliable sync. Select the first provider based on target-user needs.
4. Add structured AI capture and study-plan suggestions through a replaceable provider boundary.
5. Validate and iterate on learning-aware scheduling using real learner feedback and measurable outcomes.

Deliver working vertical slices rather than installing the entire proposed stack in advance. This sequence guides implementation; it does not require a new approval at every phase within an authorized task.

## Data and native access

- Keep API keys and OAuth refresh tokens out of frontend bundles, source control, logs, and ordinary task records. Use OS-backed credential storage for persistent secrets.
- Request only the native capabilities and provider scopes needed for implemented features. Do not expose arbitrary SQL, filesystem access, or shell execution to the UI.
- Explain which study/calendar content leaves the device for AI features, minimize what is sent, and respect the user's configured choices. Do not upload documents or calendar data implicitly.
- Preserve user data through transactional migrations. Archive/Trash is recoverable. The user explicitly requested permanent deletion from Trash; expose it only for already trashed records, with a clear in-app confirmation and atomic reference cleanup. Never cascade-delete related tasks or events. JSON export includes Trash; exports go to Downloads. Import is not implemented yet.

## Development and validation

- Use Node.js 24 via `.nvmrc` (declared minimum 22) and Rust 1.90 or newer. Use npm and maintain `package-lock.json` and `src-tauri/Cargo.lock`.
- Start the desktop app with `npm run tauri dev`; frontend-only development uses `npm run dev` at `http://127.0.0.1:3000`.
- Run `npm test` and `npm run check` for frontend changes. For Rust changes, run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo test --manifest-path src-tauri/Cargo.toml --locked`.
- For integration/configuration changes, run `npm run tauri build -- --debug --no-bundle` to verify frontend embedding. Release installers and signing are separate validation steps.
- Add meaningful regression tests for data loss, scheduling constraints, time-zone/DST behavior, migration correctness, and sync conflicts as those features are implemented. Inject time and use deterministic fixtures.
- Verify affected UI workflows in a browser or desktop runtime. Check keyboard operation and relevant loading/error/empty states for new interactions.
- Do not run forced audit fixes or framework downgrades without understanding the resulting compatibility changes. Recheck the known development-only Next.js lint dependency advisories; see `README.md` for the previous audit baseline.
- Preserve unrelated and staged user changes. Keep documentation accurate, and report checks performed plus material limitations when delivering work.

## References

- [Project setup and current limitations](README.md)
- [Google sign-in and backup setup](docs/google-setup.md)
- [Local AI, file context, and planning](docs/local-ai.md)
- [Reclaim review and scope](docs/reclaim-review.md)
- [Reclaim feature overview](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [shadcn/ui for Next.js](https://ui.shadcn.com/docs/installation/next)
- [shadcn/ui with React 19 and Tailwind 4](https://ui.shadcn.com/docs/tailwind-v4)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
