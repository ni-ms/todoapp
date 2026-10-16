# Local task capture and planning

The desktop app can run task capture entirely on this Mac: **Phonon 2 or Whisper → editable transcript → Ollama → editable task drafts → save**. It never sends audio or selected file excerpts to a hosted AI service. Inference uses fixed loopback addresses, ignores proxy environment variables, rejects redirects, and rejects Ollama cloud aliases/remote model metadata. Ollama cloud features should also be disabled at the runtime level.

Browser capture also supports local Ollama text inference, server-free on-device Phonon 2 or Whisper Tiny speech, an optional in-browser WebLLM text model, and opt-in OpenRouter hosted text models with a user-owned key. The browser sends text/excerpts to a hosted provider only when that provider is selected and drafts are requested. See [browser setup, scheduling, and limits](browser.md). The native setup below remains local-only.

## Installed on this Mac

- Homebrew `ollama` and `whisper.cpp`.
- Ollama model `qwen3:4b` (approximately 2.5 GB download), suitable as a starting point for this 16 GB Apple Silicon Mac. Other installed local text models can be selected in Settings; output quality and speed vary.
- Whisper `base.en` at `~/Library/Application Support/com.nikms.todoapp/models/ggml-base.en.bin` (about 148 MB). This model is for English. SHA-256 verified against the official model repository: `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`.
- `disable_ollama_cloud: true` merged into `~/.ollama/server.json`, preserving other existing settings. App-started Ollama also receives `OLLAMA_NO_CLOUD=1`.

Open **Settings → Local AI**, choose the speech model, then **Start local AI** and select `qwen3:4b` as the task model. The existing desktop Whisper choice is preserved until explicitly changed. Speech selection is saved in SQLite and never changes automatically on failure. This starts only installed binaries from `/opt/homebrew/bin`, `/usr/local/bin`, or `~/.local/bin`, bound to loopback. Daymark owns and stops the processes it starts when you quit the app; existing externally started services are left alone. No login service is installed. First startup can take longer while GPU kernels compile. Use Check connection if startup reports a delay.

On **My day**, type your request or press Record. Recording is capped at 90 seconds and stops the microphone when stopped or when leaving the page. Audio is converted in memory to mono 16 kHz PCM WAV, then sent to the selected local speech endpoint (Whisper at `127.0.0.1:8080/inference`, Phonon 2 at `127.0.0.1:8010/v1/audio/transcriptions`). Phonon requests explicitly name `phonon-2`; connection checks require a healthy speech server reporting Phonon 2. The transcript can be edited before asking the local model to create task drafts. Check deadlines and estimates, edit/remove drafts, and select Add tasks. Drafts do not alter the database or calendar until applied. Task creation is atomic: invalid drafts do not leave a partial batch.

macOS asks for microphone permission when recording. If denied, use System Settings → Privacy & Security → Microphone to allow Daymark, or type requests instead. The app does not record automatically. Raw audio is not saved by Daymark. Local model servers are third-party processes and have their own logging/configuration; app-started server output is discarded. Existing services retain their own logging settings.

## File and folder context

Use **Files** or **Folder**, review the extracted excerpts, and uncheck/remove anything irrelevant before generating drafts. Context remains in memory and clears when leaving My day. The app does not index your home directory or watch folders in the background.

Current support is **UTF-8 text and code**: Markdown, plain text, common programming languages, HTML/CSS, YAML/TOML, and CSV. PDF, Office files, images, and binary files are skipped; export those as text first. Symlinks, hidden entries, generated/dependency folders, and names suggesting credentials/secrets are skipped. These filters are not a secret scanner: always review selected excerpts.

Limits: 20 attachments, 128 KB per source file, 6 KB per excerpt, up to 60 KB of attached excerpts in memory (24 KB of selected excerpts plus request text per inference), directory depth 5, and 2,000 visited entries. Truncation/skips are shown in the UI. File excerpts are treated as untrusted reference data, not instructions. The model has no file-writing, shell, or calendar tools; its structured output is validated against task fields and existing tag IDs.

Google is independent of this local inference pipeline. If you separately enable Google publishing or backup, saved tasks/events and their notes can leave the device through that integration. Do not copy sensitive context into task notes if you do not want those notes backed up to your connected account.

## Weekly planning

**My day → Plan my week** runs a local deterministic planner, without an AI model or internet connection. Set study hours, weekend availability, and breaks, then preview the next seven days. It uses deadlines, priorities, remaining estimated effort after future linked sessions, current time, and existing local events. It splits work into blocks of up to 90 minutes, retains fixed events, treats all-day entries as busy, and reports work that cannot fit.

Review and add the proposed sessions. If tasks or events change while a preview is open, applying it is rejected until a new preview is generated. Undo last plan moves the generated sessions to Trash, but refuses to overwrite sessions edited after planning. Existing planned sessions stay fixed; this is **on-demand planning**, not continuous autonomous rescheduling. It does not yet model recurring habits, prerequisites, tracked actual effort, variable weekday hours, or imported Google busy time. The separate Google connection currently publishes outward only, so add outside commitments locally before planning.

## Reproducing setup on another Mac

Install from [Ollama](https://ollama.com/download/mac) and [Homebrew's whisper.cpp formula](https://formulae.brew.sh/formula/whisper.cpp), or use:

```sh
brew install ollama whisper.cpp
OLLAMA_NO_CLOUD=1 ollama serve
```

In another terminal:

```sh
ollama pull qwen3:4b
mkdir -p "$HOME/Library/Application Support/com.nikms.todoapp/models"
curl --fail --location --output "$HOME/Library/Application Support/com.nikms.todoapp/models/ggml-base.en.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Stop the temporary terminal Ollama server before using Daymark's Start local AI button. To use services manually instead:

```sh
whisper-server --host 127.0.0.1 --port 8080 \
  -m "$HOME/Library/Application Support/com.nikms.todoapp/models/ggml-base.en.bin"
```

See the official [Ollama local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features), [structured output API](https://docs.ollama.com/capabilities/structured-outputs), and [whisper.cpp server documentation](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server). No browser CORS change, public port binding, API key, or hosted backend is required.

### Optional Phonon 2 desktop setup

Install the [official Fermion runtime](https://github.com/fermionresearch/phonon) with Python 3.10 or newer. On Apple silicon, for example, using uv's isolated tools:

```sh
uv tool install --python 3.13 'fermion-research[mlx]==0.2.11'
~/.local/bin/fermion serve phonon-2 --host 127.0.0.1 --port 8010
```

The first start explicitly downloads the English model (about 164 MB, larger in memory). After setup, cached model inference runs locally. Choose **Phonon 2 · English** in desktop AI settings, then check the connection. Stop the manually started server before using app-managed startup; the app can find `fermion` in the directories listed above. A Python virtual environment elsewhere can run the manual command using its own absolute path. App-managed startup does not install Python, Fermion, or a login service. It may time out while the first model download is still in progress: complete the one-time manual setup and retry. Both speech servers can coexist on their separate ports; changing selection does not stop an externally started process.

Phonon 2 is by Fermion Research, derived from NVIDIA Parakeet TDT 0.6B v3; weights are CC-BY-4.0. See [model attribution and NOTICE](https://huggingface.co/FermionResearch/Phonon-2). The browser uses a different, larger community ONNX conversion, documented separately.

## Validation

Regression tests cover migrations, recoverable/permanent deletion, reference cleanup, WAV encoding, context exclusions/limits, invalid model output, scheduling constraints, stale previews, and edited-session protection. A real Qwen request with a text attachment and transcription of whisper.cpp's public `jfk.wav` fixture have been tested locally. Live microphone capture still needs a user permission/device check; no user microphone audio was recorded during development.

For the optional live-model integration test, start the two local servers, download the public fixture from the whisper.cpp repository, and run:

```sh
DAYMARK_SPEECH_FIXTURE=/absolute/path/to/jfk.wav \
  cargo test --manifest-path src-tauri/Cargo.toml --locked live_local_models -- --ignored
```

Phonon 2's native adapter was also tested on October 15, 2026 against the official Fermion 0.2.11 MLX server with the public JFK sample (no microphone capture). The separate optional test requires the Phonon server on port 8010:

```sh
DAYMARK_SPEECH_FIXTURE=/absolute/path/to/jfk.wav \
  cargo test --manifest-path src-tauri/Cargo.toml --locked live_phonon -- --ignored
```

Fermion was installed in a temporary verification environment for that check; a persistent native installation still requires the setup above. Unit tests cover saved selection, fixed endpoints, invalid model rejection, and rejecting Phonon 1 or non-speech health responses.

## Capture review and scheduling constraints

Text capture uses `lib/capture-contract.json` in both browser and desktop inference. It supplies the local date, current instant, IANA time zone, next eight calendar dates, and active tags. Only explicitly checked file excerpts and calendar event titles/times/zones are included; existing task contents and unchecked events are not sent. All providers use the same schema and strict validation, with at most one repair request to the same provider after invalid structured output. The shared named-weekday context, complete example, and serialized messages are checked for exact browser/native parity. After validating the model output, bounded English phrase rules resolve explicit facts and the result is validated again. Transport errors never trigger a provider switch. Native inference remains fixed-loopback and local-only; browser hosting remains an explicit choice.

“What the app understood” labels inferred effort/priority as Estimated. Other extracted details are shown as From your request; this is the model's interpretation for review, not proof that it was correct. Scheduling details can be edited in capture review and the ordinary task form. They retain exact deadline instants, earliest starts, one-off work dates, fixed start/end blocks, remaining effort, prerequisites, split/session lengths, hard windows, flexible preferred windows, time zones, and unresolved questions. Date-only deadlines remain dates. “Read tomorrow” uses a work date rather than a deadline. “After class” requires a clearly identified selected calendar event or an unresolved question. Unsupported recurrence stays a visible clarification; this does not implement recurring task generation or recurring preference records.

Tasks with unresolved questions are saved but held out of planning. Resolve the details and remove the corresponding questions before planning. Selecting a dependent draft without its prerequisite is rejected; batch save converts draft references to durable task IDs atomically. Deleting a prerequisite leaves the dependent task intact and causes an explicit missing-prerequisite planning result. The scheduler detects cycles and waits for a prerequisite's planned completion. A task marked Completed satisfies its prerequisites; completed-session history is still a separate future feature.

Both deterministic engines reserve fixed blocks before flexible work, enforce hard windows, session minimums and single-sitting tasks, and try preferred windows before other valid time. Fixed blocks must fit the weekly study hours and existing commitments. Fixed blocks shorter than remaining effort leave an explicit unscheduled remainder; they do not silently create work outside that block. Date-only deadlines use the task's scheduling zone (legacy tasks use the planning zone). Ambiguous/nonexistent daily-window boundaries are skipped rather than guessed. Existing events remain fixed; overlapping existing sessions count their union rather than double-counting effort. Preview fingerprints, transactional apply, and guarded undo still protect edits.

SQLite migration 6 adds nullable scheduling metadata without changing old task, tag, area, calendar, or Trash records. Browser records gain the same optional metadata through IndexedDB writes; no database reset is required. JSON exports/backups include scheduling metadata. ICS continues to export actual calendar sessions and date-only task deadlines; it is not a complete representation of task constraints or dependencies. Provenance history, actual/completed sessions, recurring rules, continuous replanning, incoming Google/Outlook commitments, and Canvas imports remain unimplemented.

## Repeatable interpretation benchmark

`tests/fixtures/capture-benchmark.json` contains 13 student requests with reference interpretations: exact/date-only deadlines, work dates, unknown classes, prerequisites, splitting, preferences versus limits, corrections, ambiguous times, contradictory limits, fixed appointments, remaining effort, and unsupported recurrence. These reference outputs are validated by both languages; passing those tests is **not** a measured model accuracy result. `tests/fixtures/scheduling-parity.json` is consumed by both engines with identical expected blocks and unscheduled effort, including clock-change cases, existing reservations, and dependency cycles.

With Ollama running and candidate models already installed, run:

```sh
npm run benchmark:capture -- qwen3:4b another-installed-model
```

The benchmark never downloads models or writes workspace records. It now runs the 13 original cases plus eight additional validation cases. It rejects cloud aliases/remote models, uses the production prompt/schema/settings and one bounded repair, and writes `/tmp/daymark-capture-benchmark.json` (override with `DAYMARK_BENCHMARK_OUTPUT`). It checkpoints raw responses, resolved drafts, raw-model scores, final pipeline scores, environment details, implementation fingerprint, repair attempts, per-case latency, median and p95. It checks strict task count, explicit/estimated fields, invented/missing constraints and clarification meaning. Sets and equivalent weekly window layouts compare semantically; unstated effort is checked as an editable estimate rather than against an arbitrary numeric answer. Titles/notes and clarification wording can vary; the benchmark checks whether clarification is requested. Review semantic failures manually: equivalent alternative window representations can score differently. Settings are temperature 0, context 32768, output cap 6144 tokens. Latency includes model loading and repair, so record hardware and warm/cold state when comparing runs. This benchmark measures text interpretation only. Speech tests remain separate, with a live Whisper fixture test requiring installed models/audio. The October 15, 2026 local run is documented in the measured-run section below; the original baseline exposed failures and was not treated as a passing accuracy gate. No default model change or general accuracy claim follows from this small synthetic suite.


### Explicit phrase resolution

`lib/capture-resolution.ts` and `src-tauri/src/capture_resolution.rs` consume `lib/capture-rules.json`. They resolve explicit durations (including supported written numbers), remaining effort, corrections, session sizes, single-sitting/negative-split instructions, named relative days and ISO dates, deadline versus work-day intent, exact fixed ranges, evening preferences and explicit latest-time limits. Timed dates use the requested IANA zone and its offset on that date, including DST. For a simple pair of actions joined by “before,” the second action depends on the first. Generic global phrases are not copied across multi-task batches. Unsupported or complex language remains model-interpreted and reviewable; this is a bounded English recognizer, not a general language parser or an accuracy guarantee.

Unselected/multiple class events leave “after class” unresolved. A single explicitly selected event on the requested day supplies its actual end, without sending the rest of the calendar. Conflicting limits, unsupported recurrence, and missing am/pm become concrete review questions. Existing questions about unsupported instructions are preserved. Explicit corrections update obsolete duration text in titles without changing unrelated chapter numbers. Model-proposed effort without explicit support is labeled Estimated; the user can override it. These rules run in the application and benchmark, rather than only altering test answers.

Use `DAYMARK_CAPTURE_CASE='case name'` for a single benchmark case. `DAYMARK_CAPTURE_THINK=1` is an experimental local benchmark setting; routine capture retains `think: false`. A reasoning-mode probe was substantially slower on the tested hardware. `cargo test --manifest-path src-tauri/Cargo.toml --locked live_local_text_capture_resolves_explicit_constraints -- --ignored` exercises the real native text inference path against installed `qwen3:4b` without saving tasks. The separate combined speech fixture remains opt-in.


### Measured local run: October 15, 2026

Machine: Apple M4 MacBook Air, 16 GB RAM. Ollama 0.40.4. The only installed completion model was `qwen3:4b`, Q4_K_M (about 2.5 GB); no models were downloaded. Ollama was started on `127.0.0.1:11434` with cloud access disabled.

| Run | Cases passing | Notes |
| --- | --- | --- |
| Original baseline | 0/13 | 11 responses were schema-valid; wrong dates, invented questions, incorrect estimate labels, dropped limits and invalid time constraints remained. Rescoring with fair estimate/set semantics still yielded 0/13. |
| Revised shared prompt, before explicit resolution | 2/13 | Named weekdays and a complete example improved some extraction, but instructions were still missed. |
| Finished capture pipeline | 21/21 | All 13 original regression cases and eight additional validation cases passed after the fixes. |
| Raw model output on the final case runs | 4/21 | Explicit resolution and revalidation make a substantial contribution to the finished result. |
| Experimental reasoning-mode probe | 1/1 | The soft/hard-window case passed, but took 146.4 seconds; routine capture retains reasoning disabled. |

Final verification used one full 21-case run (20 passed), followed by fresh runs of both conflict cases affected by the last fix (2 passed). Every captured output was then replayed through the finished interpreter; the identical prompts and captured-failure fixtures also pass in native Rust and browser TypeScript. The eight added cases vary dates, effort, corrections, fixed times, hard cutoffs, contradictions and selected class context, including spring/fall DST. They have now been used during development and should be treated as regression cases in future evaluations.

Observed warm-model latency was **7.6 seconds median**, **11.7 seconds p95**, and **14.5 seconds maximum**, including a repair when needed. These are single-run development observations with background activity, not an isolated performance study. The original first request took 37.1 seconds including loading. The suite checks explicit facts, task count, constraints, clarification meaning and estimate labeling; it does not establish the quality of an unstated effort estimate or general accuracy on real learner requests. Keep the editable review step.

The benchmark was corrected to accept equivalent sets/window layouts and valid labeled estimates rather than a single arbitrary effort value. Reference interpretations now retain an explicit work day even when its time/limits need clarification, and explicit fixed ranges are consistently non-splittable. Clarification checks reject asking which day Friday is when the ambiguity is am/pm; correction checks catch obsolete duration text in titles. Ollama's schema converter did not support the original `\d` date patterns, so the shared schema now uses `[0-9]` while typed calendar validation remains authoritative.

Measured outputs, model digest, settings, implementation fingerprints, per-case failures and timings are saved in [the benchmark JSON](benchmarks/2026-10-15-qwen3-4b.json). The benchmark sends only synthetic fixtures to the installed local model and writes no tasks. A separate real native text-capture test also exercises Ollama through the Rust path without saving tasks. Speech transcription remains a separate validation step.
