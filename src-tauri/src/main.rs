// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod areas;
mod backup;
mod calendar;
mod google;
mod ical;
mod local_ai;
mod planner;
mod services;
mod todo_utils;
mod trash;
mod workspace;

use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use workspace::{CourseInput, Store, TaskInput, Workspace};

type Database = Arc<Mutex<Store>>;
async fn with_store<T: Send + 'static>(
    db: Database,
    operation: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = db
            .lock()
            .map_err(|_| "The workspace is unavailable. Restart the app.".to_string())?;
        operation(&store)
    })
    .await
    .map_err(|_| "The workspace operation was interrupted.".to_string())?
}
#[tauri::command]
async fn load_workspace(db: State<'_, Database>) -> Result<Workspace, String> {
    with_store(db.inner().clone(), |store| store.snapshot()).await
}
#[tauri::command]
async fn save_area(db: State<'_, Database>, input: areas::AreaInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_area(input)).await
}
#[tauri::command]
async fn save_course(db: State<'_, Database>, input: CourseInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_course(input)).await
}
#[tauri::command]
async fn save_task(db: State<'_, Database>, input: TaskInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_task(input)).await
}
#[tauri::command]
async fn set_deleted(
    db: State<'_, Database>,
    entity: String,
    id: String,
    deleted: bool,
) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| {
        store.set_deleted(&entity, &id, deleted)
    })
    .await
}
#[tauri::command]
async fn export_workspace(
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| "Your Downloads folder is unavailable.".to_string())?;
    let filename = format!("daymark-{}.json", uuid::Uuid::new_v4());
    with_store(db.inner().clone(), move |store| {
        let snapshot = store.snapshot()?;
        let document = serde_json::json!({
            "format": "daymark-workspace", "version": 2,
            "exportedAt": chrono::Utc::now().to_rfc3339(),
            "areas": snapshot.areas, "courses": snapshot.courses, "tasks": snapshot.tasks, "tags":snapshot.tags, "events":snapshot.events,
        });
        let destination = downloads.join(filename);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "Could not create an export in Downloads.".to_string())?;
        serde_json::to_writer_pretty(&file, &document)
            .map_err(|_| "The export could not be written.".to_string())?;
        file.sync_all()
            .map_err(|_| "The export could not be saved.".to_string())?;
        Ok(destination.to_string_lossy().to_string())
    })
    .await
}
#[tauri::command]
async fn preview_plan(
    db: State<'_, Database>,
    pending: State<'_, planner::PendingPlan>,
    options: planner::Options,
) -> Result<planner::Proposal, String> {
    let db = db.inner().clone();
    let p = pending.inner().clone();
    tauri::async_runtime::spawn_blocking(move || planner::preview(&db, &p, options))
        .await
        .map_err(|_| "Planning interrupted.")?
}
#[tauri::command]
async fn apply_plan(
    db: State<'_, Database>,
    pending: State<'_, planner::PendingPlan>,
    id: String,
) -> Result<Workspace, String> {
    let db = db.inner().clone();
    let p = pending.inner().clone();
    tauri::async_runtime::spawn_blocking(move || planner::apply(&db, &p, id))
        .await
        .map_err(|_| "Planning interrupted.")?
}
#[tauri::command]
async fn plan_undo_available(db: State<'_, Database>) -> Result<bool, String> {
    with_store(db.inner().clone(), |store| {
        Ok(store
            .preference("last_plan")
            .and_then(|raw| serde_json::from_str::<Vec<(String, String)>>(&raw).ok())
            .is_some_and(|v| !v.is_empty()))
    })
    .await
}
#[tauri::command]
async fn undo_plan(db: State<'_, Database>) -> Result<Workspace, String> {
    with_store(db.inner().clone(), planner::undo).await
}
#[tauri::command]
async fn start_local_ai(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    services: State<'_, local_ai::ServiceState>,
) -> Result<local_ai::LocalStatus, String> {
    let db = db.inner().clone();
    let services = services.inner().clone();
    let model = app
        .path()
        .app_data_dir()
        .map_err(|_| "App data unavailable.")?
        .join("models/ggml-base.en.bin");
    tauri::async_runtime::spawn_blocking(move || local_ai::start_services(&db, &services, model))
        .await
        .map_err(|_| "Local service startup interrupted.")?
}
#[tauri::command]
async fn stop_local_ai(services: State<'_, local_ai::ServiceState>) -> Result<(), String> {
    local_ai::stop_services(services.inner())
}
#[tauri::command]
async fn local_ai_status(db: State<'_, Database>) -> Result<local_ai::LocalStatus, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || local_ai::status(&db))
        .await
        .map_err(|_| "Local AI check interrupted.")?
}
#[tauri::command]
async fn configure_local_ai(db: State<'_, Database>, model: String) -> Result<(), String> {
    local_ai::configure(db.inner(), model)
}
#[tauri::command]
async fn pick_context(
    app: tauri::AppHandle,
    cache: State<'_, local_ai::ContextStore>,
    folder: bool,
) -> Result<local_ai::ContextResult, String> {
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let paths = if folder {
            app.dialog()
                .file()
                .set_title("Choose a folder for local AI context")
                .blocking_pick_folder()
                .into_iter()
                .collect::<Vec<_>>()
        } else {
            app.dialog()
                .file()
                .set_title("Choose text or source files for local AI context")
                .blocking_pick_files()
                .unwrap_or_default()
        };
        let paths = paths
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map_err(|_| "Choose local files or folders.".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        local_ai::collect(paths, &cache)
    })
    .await
    .map_err(|_| "Context selection interrupted.")?
}
#[tauri::command]
async fn remove_context(
    cache: State<'_, local_ai::ContextStore>,
    id: String,
) -> Result<(), String> {
    cache
        .lock()
        .map_err(|_| "Context unavailable.")?
        .remove(&id);
    Ok(())
}
#[tauri::command]
async fn extract_tasks(
    db: State<'_, Database>,
    cache: State<'_, local_ai::ContextStore>,
    text: String,
    context_ids: Vec<String>,
    today: String,
) -> Result<Vec<local_ai::Draft>, String> {
    let db = db.inner().clone();
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        local_ai::extract(&db, &cache, text, context_ids, today)
    })
    .await
    .map_err(|_| "Local task capture interrupted.")?
}
#[tauri::command]
async fn transcribe_audio(audio: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || local_ai::transcribe(audio))
        .await
        .map_err(|_| "Transcription interrupted.")?
}
#[tauri::command]
async fn purge_record(
    db: State<'_, Database>,
    entity: String,
    id: String,
) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |s| s.purge_record(&entity, &id)).await
}
#[tauri::command]
async fn save_tasks(db: State<'_, Database>, inputs: Vec<TaskInput>) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |s| s.save_tasks(inputs)).await
}
#[tauri::command]
async fn delete_tag(db: State<'_, Database>, id: String) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.delete_tag(&id)).await
}
#[tauri::command]
async fn save_tag(db: State<'_, Database>, input: calendar::TagInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_tag(input)).await
}
#[tauri::command]
async fn save_event(
    db: State<'_, Database>,
    input: calendar::EventInput,
) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_event(input)).await
}
#[tauri::command]
async fn export_calendar(app: tauri::AppHandle, db: State<'_, Database>) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| "Downloads is unavailable.")?;
    with_store(db.inner().clone(), move |store| {
        let output = ical::calendar(&store.snapshot()?);
        let path = downloads.join(format!("daymark-calendar-{}.ics", uuid::Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Could not create calendar export.")?;
        std::io::Write::write_all(&mut file, output.as_bytes())
            .map_err(|_| "Could not write calendar export.")?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
}
#[tauri::command]
async fn backup_status(db: State<'_, Database>) -> Result<backup::BackupStatus, String> {
    with_store(db.inner().clone(), |store| Ok(store.backup_status())).await
}
#[tauri::command]
async fn configure_backup(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    action: String,
) -> Result<backup::BackupStatus, String> {
    match action.as_str() {
        "choose" => {
            use tauri_plugin_dialog::DialogExt;
            let chosen = tauri::async_runtime::spawn_blocking(move || {
                app.dialog()
                    .file()
                    .set_title("Choose a Google Drive, Dropbox, or backup folder")
                    .blocking_pick_folder()
            })
            .await
            .map_err(|_| "Folder selection was interrupted.")?;
            if let Some(path) = chosen {
                let path = path.into_path().map_err(|_| "Choose a local folder.")?;
                with_store(db.inner().clone(), move |store| {
                    store.choose_backup_folder(&path)
                })
                .await
            } else {
                with_store(db.inner().clone(), |store| Ok(store.backup_status())).await
            }
        }
        "disable" => with_store(db.inner().clone(), |store| store.disable_backup()).await,
        "now" => with_store(db.inner().clone(), |store| store.run_backup(true)).await,
        _ => Err("Unknown backup action.".into()),
    }
}
#[tauri::command]
async fn google_status(db: State<'_, Database>) -> Result<google::GoogleStatus, String> {
    google::status(db.inner())
}
#[tauri::command]
async fn google_action(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    lock: State<'_, google::GoogleLock>,
    action: String,
    time_zone: Option<String>,
) -> Result<google::GoogleStatus, String> {
    let database = db.inner().clone();
    let lock = lock.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .try_lock()
            .map_err(|_| "A Google operation is already running.")?;
        match action.as_str() {
            "configure" => {
                use tauri_plugin_dialog::DialogExt;
                if let Some(file) = app
                    .dialog()
                    .file()
                    .set_title("Choose your Google Desktop OAuth client JSON")
                    .add_filter("OAuth client", &["json"])
                    .blocking_pick_file()
                {
                    let path = file.into_path().map_err(|_| "Choose a local JSON file.")?;
                    let meta = std::fs::metadata(&path)
                        .map_err(|_| "Could not read the Google configuration file.")?;
                    if meta.len() > 65536 {
                        return Err("Choose a Google Desktop OAuth client JSON file.".into());
                    }
                    let data = std::fs::read_to_string(path)
                        .map_err(|_| "Could not read the Google configuration file.")?;
                    google::configure(&database, &data)
                } else {
                    google::status(&database)
                }
            }
            "help" => {
                use tauri_plugin_opener::OpenerExt;
                app.opener()
                    .open_url(
                        "https://console.cloud.google.com/apis/credentials",
                        None::<&str>,
                    )
                    .map_err(|_| "Could not open Google Cloud.")?;
                google::status(&database)
            }
            "connect" => google::connect(&app, &database, time_zone.as_deref().unwrap_or("UTC")),
            "sync" => google::sync(&database),
            "disconnect" => google::disconnect(&database),
            "pause" => google::automatic(&database, false),
            "resume" => google::automatic(&database, true),
            _ => Err("Unknown Google connection action.".into()),
        }
    })
    .await
    .map_err(|_| "The Google operation was interrupted.".to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let store =
                Store::open(&directory.join("learner.sqlite3")).map_err(std::io::Error::other)?;
            let shared = Arc::new(Mutex::new(store));
            let backup_db = shared.clone();
            let google_lock: google::GoogleLock = Arc::new(Mutex::new(()));
            let background_google = google_lock.clone();
            app.manage(google_lock);
            app.manage(local_ai::ContextStore::default());
            app.manage(local_ai::ServiceState::default());
            app.manage(planner::PendingPlan::default());
            std::thread::Builder::new()
                .name("daymark-backup".into())
                .spawn(move || loop {
                    if let Ok(store) = backup_db.lock() {
                        let _ = store.run_backup(false);
                    }
                    if google::status(&backup_db).is_ok_and(|s| s.connected && s.automatic) {
                        if let Ok(_guard) = background_google.try_lock() {
                            let _ = google::sync(&backup_db);
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(60));
                })?;
            app.manage(shared);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_area,
            save_course,
            save_task,
            set_deleted,
            export_workspace,
            save_tag,
            delete_tag,
            purge_record,
            save_tasks,
            preview_plan,
            apply_plan,
            undo_plan,
            plan_undo_available,
            start_local_ai,
            stop_local_ai,
            local_ai_status,
            configure_local_ai,
            pick_context,
            remove_context,
            extract_tasks,
            transcribe_audio,
            save_event,
            export_calendar,
            backup_status,
            configure_backup,
            google_status,
            google_action
        ])
        .build(tauri::generate_context!())
        .expect("error while building learner workspace")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(services) = app.try_state::<local_ai::ServiceState>() {
                    let _ = local_ai::stop_services(services.inner());
                }
            }
        });
}
