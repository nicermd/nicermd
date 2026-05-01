// Tauri shell entry. Runs the bundled Vite frontend in a frameless-overlay
// window with a native macOS menu. The menu emits events the web frontend
// listens for (file-open, save, focus-mode-toggle, mode-switch); Rust holds
// no state about the document.

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Wry};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(handle_menu_event);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        // OS-level file-open events: macOS fires this when the user picks
        // 'Open With → Nicer.md' in Finder, double-clicks a .md file with
        // Nicer.md as the default app, or drops a file onto the Dock icon.
        // We extract the file path and forward it to the frontend; the web
        // listener (tauri-bridge.ts) reads the file via tauri-plugin-fs
        // and updates the harness, same flow as the in-app Open dialog.
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();
                    if let Err(err) = app_handle.emit("menu:file-open-path", path_str) {
                        log::error!("failed to emit menu:file-open-path: {err}");
                    }
                }
            }
        }
        // macOS convention is for apps to keep running with no windows;
        // for a single-window reader that surprises users — they expect
        // the red X to fully quit. Single-window app, so any close
        // request means the user's done.
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { .. },
            ..
        } => {
            app_handle.exit(0);
        }
        _ => {}
    });
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let app_submenu = SubmenuBuilder::new(app, "Nicer.md")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Nicer.md"),
            None,
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file-new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file-open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file-save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file-save-as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("view-mode-1", "Read")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view-mode-2", "Write")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view-mode-3", "Split")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view-mode-4", "Code")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("view-cycle-mode", "Cycle Modes")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("view-focus", "Focus Mode")
                .accelerator("CmdOrCtrl+.")
                .build(app)?,
        )
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("view-reload", "Reload")
                .accelerator("CmdOrCtrl+R")
                .build(app)?,
        )
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    log::info!("menu event: {id}");

    // File events go up to the web side as named events the frontend listens
    // to. The Rust side stays stateless.
    match id {
        "file-new" => emit(app, "menu:file-new", ()),
        "file-open" => emit(app, "menu:file-open", ()),
        "file-save" => emit(app, "menu:file-save", ()),
        "file-save-as" => emit(app, "menu:file-save-as", ()),
        "view-mode-1" => emit(app, "menu:view-mode", 1),
        "view-mode-2" => emit(app, "menu:view-mode", 2),
        "view-mode-3" => emit(app, "menu:view-mode", 3),
        "view-mode-4" => emit(app, "menu:view-mode", 4),
        "view-cycle-mode" => emit(app, "menu:view-cycle", ()),
        "view-focus" => emit(app, "menu:view-focus-toggle", ()),
        "view-reload" => emit(app, "menu:view-reload", ()),
        _ => {}
    }
}

fn emit<P: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: P) {
    if let Err(err) = app.emit(event, payload) {
        log::error!("failed to emit {event}: {err}");
    }
}
