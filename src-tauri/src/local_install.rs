//! Explicit, allowlisted local-AI setup. No shell or frontend-supplied URLs/paths.
use crate::{local_ai, workspace::Result, Database};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Package {
    All,
    Ollama,
    #[serde(rename = "phonon-2")]
    Phonon2,
    Whisper,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub busy: bool,
    pub message: String,
    pub error: String,
}
#[derive(Default)]
pub struct Installer {
    progress: Mutex<Progress>,
    cancelled: AtomicBool,
}
pub type InstallState = Arc<Installer>;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub progress: Progress,
    pub supported: bool,
    pub package_manager: bool,
    pub ollama: bool,
    pub phonon: bool,
    pub whisper: bool,
}
pub fn phonon_binary(root: &Path) -> PathBuf {
    root.join("local-ai/phonon/bin/fermion")
}
pub fn speech_environment(command: &mut Command, root: &Path) {
    command
        .env("FERMION_CACHE_DIR", root.join("local-ai/fermion-cache"))
        .env("HF_HOME", root.join("local-ai/huggingface"));
}
pub fn snapshot(state: &InstallState, root: &Path) -> Result<SetupStatus> {
    Ok(SetupStatus {
        progress: state
            .progress
            .lock()
            .map_err(|_| "Setup status unavailable.")?
            .clone(),
        supported: cfg!(target_os = "macos"),
        package_manager: local_ai::binary("brew").is_ok(),
        ollama: local_ai::binary("ollama").is_ok(),
        phonon: phonon_binary(root).is_file() && root.join("local-ai/phonon-ready").is_file(),
        whisper: local_ai::binary("whisper-server").is_ok()
            && root.join("models/ggml-base.en.bin").is_file(),
    })
}
impl Installer {
    pub fn begin(&self) -> Result<()> {
        let mut progress = self.progress.lock().map_err(|_| "Setup unavailable.")?;
        if progress.busy {
            return Err("A local AI installation is already running.".into());
        }
        self.cancelled.store(false, Ordering::SeqCst);
        *progress = Progress {
            busy: true,
            message: "Preparing local AI installation…".into(),
            error: String::new(),
        };
        Ok(())
    }
    pub fn finish(&self, result: Result<()>) {
        if let Ok(mut p) = self.progress.lock() {
            p.busy = false;
            match result {
                Ok(()) => {
                    p.message =
                        "Installation complete. Choose a model, then start local AI.".into();
                    p.error.clear();
                }
                Err(e) => {
                    p.message.clear();
                    p.error = e;
                }
            }
        }
    }
    fn report(&self, text: impl Into<String>) {
        if let Ok(mut p) = self.progress.lock() {
            p.message = text.into();
        }
    }
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err("Installation canceled. Completed downloads are kept; retry to continue.".into())
        } else {
            Ok(())
        }
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn idle(&self) -> Result<()> {
        if self.progress.lock().map_err(|_| "Setup unavailable.")?.busy {
            Err("Wait for local AI setup to finish or cancel it first.".into())
        } else {
            Ok(())
        }
    }
    // Third-party output can contain proxy credentials and user paths; do not retain it.
    fn run(&self, command: &mut Command, label: &str) -> Result<()> {
        self.check()?;
        self.report(label);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|_| format!("Could not start {label}. Retry setup."))?;
        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Err(_) => break Err("Could not check installer process.".to_string()),
                _ => {}
            }
            if self.check().is_err() || start.elapsed() > Duration::from_secs(3600) {
                #[cfg(unix)]
                {
                    let _ = Command::new("/bin/kill")
                        .args(["-TERM", "--", &format!("-{}", child.id())])
                        .status();
                }
                #[cfg(unix)]
                {
                    let _ = Command::new("/bin/kill")
                        .args(["-KILL", "--", &format!("-{}", child.id())])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();
                }
                let _ = child.kill();
                let _ = child.wait();
                break Err(if self.check().is_err() {
                    "Installation canceled. Retry to continue.".into()
                } else {
                    "Installation timed out. Check your connection and retry.".into()
                });
            }
            std::thread::sleep(Duration::from_millis(150));
        };
        if !status?.success() {
            // Do not echo installer output: it can contain proxy credentials or user paths.
            return Err(format!("{label} failed. Check your connection and free disk space, then retry. If Homebrew needs maintenance, run brew doctor in Terminal."));
        }
        self.check()
    }
    fn brew(&self, formula: &str) -> Result<()> {
        let brew = local_ai::binary("brew").map_err(|_| "Install Homebrew from brew.sh once, then retry. Daymark uses it to install verified packages without administrator access.".to_string())?;
        self.run(
            Command::new(brew)
                .args(["install", formula])
                .env("HOMEBREW_NO_AUTO_UPDATE", "1")
                .env("HOMEBREW_NO_ANALYTICS", "1"),
            &format!("Installing {formula} and its dependencies…"),
        )
    }
    fn phonon(&self, root: &Path) -> Result<()> {
        let marker = root.join("local-ai/phonon-ready");
        if local_ai::binary("uv").is_err() {
            self.brew("uv")?;
        }
        let uv = local_ai::binary("uv")?;
        let env = root.join("local-ai/phonon");
        let mut create = Command::new(&uv);
        create
            .args([
                "venv",
                "--python",
                if cfg!(target_arch = "aarch64") {
                    "3.13"
                } else {
                    "3.11"
                },
                "--managed-python",
            ])
            .arg(&env)
            .env("UV_PYTHON_INSTALL_DIR", root.join("local-ai/python"))
            .env("UV_CACHE_DIR", root.join("local-ai/uv-cache"));
        if !env.join("bin/python").is_file() {
            self.run(&mut create, "Downloading Python for Phonon 2…")?;
        }
        let mut install = Command::new(&uv);
        install
            .args(["pip", "install", "--python"])
            .arg(env.join("bin/python"))
            .arg(if cfg!(target_arch = "aarch64") {
                "fermion-research[mlx]==0.2.11"
            } else {
                "fermion-research==0.2.11"
            })
            .env("UV_CACHE_DIR", root.join("local-ai/uv-cache"));
        self.run(&mut install, "Installing Phonon 2 runtime…")?;
        let mut fetch = Command::new(env.join("bin/python"));
        fetch.args(["-c", "import fermion; fermion.load_speech('phonon-2')"]);
        speech_environment(&mut fetch, root);
        self.run(
            &mut fetch,
            "Downloading and verifying Phonon 2 (about 164 MB)…",
        )?;
        fs::write(marker, "fermion-research==0.2.11\n")
            .map_err(|_| "Could not save Phonon setup state.")?;
        Ok(())
    }
    fn whisper(&self, root: &Path) -> Result<()> {
        if local_ai::binary("whisper-server").is_err() {
            self.brew("whisper.cpp")?;
        }
        let destination = root.join("models/ggml-base.en.bin");
        if destination.is_file() && verify_whisper(&destination).is_ok() {
            return Ok(());
        }
        self.report("Downloading Whisper base.en (about 148 MB)…");
        fs::create_dir_all(destination.parent().unwrap())
            .map_err(|_| "Could not create the model folder.")?;
        let mut temp = tempfile::NamedTempFile::new_in(destination.parent().unwrap())
            .map_err(|_| "Could not create model download.")?;
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 5
                    && attempt.url().scheme() == "https"
                    && attempt.url().host_str().is_some_and(|h| {
                        h == "huggingface.co"
                            || h.ends_with(".huggingface.co")
                            || h.ends_with(".hf.co")
                    })
                {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(1800))
            .build()
            .map_err(|_| "Could not start download.")?;
        let mut response = client
            .get("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin")
            .send()
            .map_err(|_| "Whisper download failed. Check your connection and retry.")?;
        if !response.status().is_success() {
            return Err("Whisper download failed. Retry later.".into());
        }
        let mut buffer = [0; 65536];
        let mut size = 0;
        loop {
            self.check()?;
            let n = response
                .read(&mut buffer)
                .map_err(|_| "Whisper download interrupted. Retry to continue.")?;
            if n == 0 {
                break;
            }
            size += n;
            if size > 160_000_000 {
                return Err("Whisper download exceeded its expected size.".into());
            }
            temp.write_all(&buffer[..n])
                .map_err(|_| "Could not save model. Check free disk space.")?;
            self.report(format!(
                "Downloading Whisper: {} / 148 MB",
                size / 1_000_000
            ));
        }
        verify_whisper(temp.path())?;
        self.check()?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "Could not save model.")?;
        temp.persist(destination)
            .map_err(|_| "Could not finish installing Whisper.")?;
        Ok(())
    }
}
fn verify_whisper(path: &Path) -> Result<()> {
    let mut file = fs::File::open(path).map_err(|_| "Could not read Whisper model.")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| "Could not verify Whisper model.")?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    if hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        != "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
    {
        return Err("Whisper checksum did not match. Retry to download a verified copy.".into());
    }
    Ok(())
}
pub fn install(
    state: &InstallState,
    package: Package,
    root: &Path,
    db: &Database,
    services: &local_ai::ServiceState,
) -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Err("Automatic native setup currently supports macOS. Browser models can be downloaded in the browser app.".into());
    }
    fs::create_dir_all(root.join("local-ai"))
        .map_err(|_| "Could not create the local AI folder.")?;
    if matches!(package, Package::All | Package::Ollama) {
        if local_ai::binary("ollama").is_err() {
            state.brew("ollama")?;
        }
        state.check()?;
        state.report("Starting Ollama…");
        local_ai::start_ollama(services)?;
        for _ in 0..60 {
            state.check()?;
            if local_ai::status(db)?.ollama_available {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let mut command = Command::new(local_ai::binary("ollama")?);
        command
            .args(["pull", "qwen3:4b"])
            .env("OLLAMA_HOST", "127.0.0.1:11434")
            .env("OLLAMA_NO_CLOUD", "1");
        state.run(
            &mut command,
            "Downloading Qwen 3 4B task model (about 2.5 GB)…",
        )?;
    }
    if matches!(package, Package::All | Package::Phonon2) {
        state.phonon(root)?;
    }
    if matches!(package, Package::All | Package::Whisper) {
        state.whisper(root)?;
    }
    state.check()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn single_job_cancel_and_retry() {
        let state = Installer::default();
        state.begin().unwrap();
        assert!(state.begin().is_err());
        assert!(state.idle().is_err());
        state.cancel();
        assert!(state.check().is_err());
        state.finish(Err("Canceled".into()));
        assert!(state.idle().is_ok());
        state.begin().unwrap();
        assert!(state.check().is_ok());
    }
    #[test]
    fn rejects_unknown_package_and_corrupt_model() {
        for id in ["all", "ollama", "phonon-2", "whisper"] {
            assert!(
                serde_json::from_value::<Package>(serde_json::json!(id)).is_ok(),
                "{id}"
            );
        }
        assert!(serde_json::from_str::<Package>("\"../../shell\"").is_err());
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), "invalid").unwrap();
        assert!(verify_whisper(file.path()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn cancels_running_installer_and_rejects_failed_process() {
        let state = InstallState::default();
        state.begin().unwrap();
        let cancel = state.clone();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            cancel.cancel();
        });
        let start = Instant::now();
        assert!(state
            .run(Command::new("/bin/sleep").arg("20"), "test install")
            .is_err());
        assert!(start.elapsed() < Duration::from_secs(5));
        worker.join().unwrap();
        state.finish(Err("Canceled".into()));
        state.begin().unwrap();
        assert!(state
            .run(&mut Command::new("/usr/bin/false"), "test install")
            .is_err());
    }
    #[test]
    #[ignore = "Downloads Python, Phonon dependencies and weights; requires internet and several GB"]
    fn live_managed_phonon_install() {
        let root = std::env::var_os("DAYMARK_INSTALL_TEST_ROOT")
            .map(PathBuf::from)
            .expect("Use a disposable test directory");
        fs::create_dir_all(root.join("local-ai")).unwrap();
        let state = InstallState::default();
        state.begin().unwrap();
        state.phonon(&root).unwrap();
        assert!(snapshot(&state, &root).unwrap().phonon);
    }
    #[test]
    fn incomplete_phonon_is_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let state = InstallState::default();
        fs::create_dir_all(phonon_binary(dir.path()).parent().unwrap()).unwrap();
        fs::write(phonon_binary(dir.path()), "partial").unwrap();
        assert!(!snapshot(&state, dir.path()).unwrap().phonon);
    }
}
