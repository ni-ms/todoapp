fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "load_workspace",
            "save_course",
            "save_task",
            "set_deleted",
            "export_workspace",
            "save_tag",
            "delete_tag",
            "save_event",
            "export_calendar",
            "backup_status",
            "configure_backup",
            "google_status",
            "google_action",
        ]));
    tauri_build::try_build(attributes).expect("failed to build Tauri application");
}
