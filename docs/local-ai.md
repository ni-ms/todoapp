# Local task capture and planning

Daymark can run task capture entirely on this Mac: **Whisper → editable transcript → Ollama → editable task drafts → save**. It never sends audio or selected file excerpts to a hosted AI service. Inference uses fixed loopback addresses, ignores proxy environment variables, rejects redirects, and rejects Ollama cloud aliases/remote model metadata. Ollama cloud features should also be disabled at the runtime level.

## Installed on this Mac

- Homebrew `ollama` and `whisper.cpp`.
- Ollama model `qwen3:4b` (approximately 2.5 GB download), suitable as a starting point for this 16 GB Apple Silicon Mac. Other installed local text models can be selected in Settings; output quality and speed vary.
- Whisper `base.en` at `~/Library/Application Support/com.nikms.todoapp/models/ggml-base.en.bin` (about 148 MB). This model is for English. SHA-256 verified against the official model repository: `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`.
- `disable_ollama_cloud: true` merged into `~/.ollama/server.json`, preserving other existing settings. App-started Ollama also receives `OLLAMA_NO_CLOUD=1`.

Open **Settings → Local AI → Start local AI**, then select `qwen3:4b` as the task model. This starts only installed binaries from `/opt/homebrew/bin` or `/usr/local/bin`, bound to loopback. Daymark owns and stops the processes it starts when you quit the app; existing externally started services are left alone. No login service is installed. First startup can take longer while GPU kernels compile. Use Check connection if startup reports a delay.

On **My day**, type your request or press Record. Recording is capped at 90 seconds and stops the microphone when stopped or when leaving the page. Audio is converted in memory to mono 16 kHz PCM WAV, then sent to the local Whisper endpoint. The transcript can be edited before asking the local model to create task drafts. Check deadlines and estimates, edit/remove drafts, and select Add tasks. Drafts do not alter the database or calendar until applied. Task creation is atomic: invalid drafts do not leave a partial batch.

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

## Validation

Regression tests cover migrations, recoverable/permanent deletion, reference cleanup, WAV encoding, context exclusions/limits, invalid model output, scheduling constraints, stale previews, and edited-session protection. A real Qwen request with a text attachment and transcription of whisper.cpp's public `jfk.wav` fixture have been tested locally. Live microphone capture still needs a user permission/device check; no user microphone audio was recorded during development.

For the optional live-model integration test, start the two local servers, download the public fixture from the whisper.cpp repository, and run:

```sh
DAYMARK_SPEECH_FIXTURE=/absolute/path/to/jfk.wav \
  cargo test --manifest-path src-tauri/Cargo.toml --locked live_local_models -- --ignored
```
