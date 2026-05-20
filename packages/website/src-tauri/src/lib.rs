// Tauri shell entry. Runs the bundled Vite frontend in webview windows
// with a native macOS menu. The menu emits events the web frontend
// listens for (file-open, save, focus-mode-toggle, mode-switch); Rust
// holds no state about the documents themselves.
//
// Multi-window: Cmd+N spawns a new window with its own webview context.
// Each window's JS module state (doc-source, harness) is naturally
// isolated because each webview is its own JS realm. localStorage IS
// shared across same-origin windows, so per-window state that needs
// disk persistence (autosave snapshots) is scoped on the JS side by
// the window label. Menu events route to the focused window only, so
// Cmd+S in window A doesn't trigger a save in window B.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_fs::FsExt;

// Cold-start replay cache for OS-level file-open events. Without this,
// `RunEvent::Opened` fires before the JS bundle has finished loading
// and registered its `menu:file-open-path` listener — the emit goes to
// no listener and the requested file is silently dropped. Mirrors the
// deep-link plugin's getCurrent() / onOpenUrl cache+listen pattern.
//
// Lifecycle:
// 1. App launches. State<PendingOpened> initialised with empty paths
//    and drained=false.
// 2. Any RunEvent::Opened arriving before the frontend signals ready
//    pushes its path onto `paths` (and never emits — there's no
//    listener to receive it yet).
// 3. JS bundle boots, setupTauriBridge registers its listener, then
//    calls `drain_pending_opened` which atomically swaps `paths` empty
//    AND flips `drained=true`. Returned paths are opened by the JS
//    side as if they'd arrived through the listener.
// 4. Subsequent RunEvent::Opened see drained=true and emit live to
//    the focused window's listener (warm-state Open With / Dock drop).
// Mutex serialises check-and-cache vs drain — no path can be lost
// during the cold→warm transition.
struct PendingOpened {
    paths: Mutex<Vec<String>>,
    drained: AtomicBool,
}

#[tauri::command]
fn drain_pending_opened(state: tauri::State<'_, PendingOpened>) -> Vec<String> {
    let mut paths_guard = state.paths.lock().unwrap();
    state.drained.store(true, Ordering::Release);
    std::mem::take(&mut *paths_guard)
}

// Monotonic counter for new-window labels. Labels must be unique
// across the app lifetime; the main window is "main", subsequent
// windows are "window-2", "window-3", etc. Order doesn't matter for
// correctness — only uniqueness.
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(2);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(PendingOpened {
            paths: Mutex::new(Vec::new()),
            drained: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![drain_pending_opened])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let (menu, window_submenu) = build_menu(app.handle())?;
            app.set_menu(menu)?;
            // Designate the Window submenu as macOS's NSApp.windowsMenu
            // — auto-appends open windows so minimised ones can be
            // brought back, and enables Cmd+` cycling. MUST happen
            // AFTER `set_menu`, because muda's
            // `resolve_ns_menu_for_nsapp` looks up the submenu via the
            // app's currently-installed main menu; calling it before
            // install silently no-ops (no main menu → returns None).
            // That silent no-op is why the menu marker was broken in
            // 0.1.6 even though it appeared correct in the build_menu
            // body before.
            let _ = window_submenu.set_as_windows_menu_for_nsapp();
            app.on_menu_event(handle_menu_event);

            // Deep-link handling is done entirely on the JS side via
            // `@tauri-apps/plugin-deep-link`'s `onOpenUrl` (warm state)
            // and `getCurrent` (cold start). A Rust `on_open_url`
            // registered here would race the WebView readiness on cold
            // start — the URL arrives before the frontend has a chance
            // to register a listener, so the event is dropped. Pulling
            // from JS once the frontend is up sidesteps that timing.
            //
            // Linux + dev-on-Windows still need explicit scheme
            // registration at runtime (the bundler hook doesn't run in
            // dev). On macOS the scheme registers via the bundled
            // Info.plist generated by the plugin's build hook.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        // OS-level file-open events: macOS fires this when the user picks
        // 'Open With → Nicer.md' in Finder, double-clicks a .md file with
        // Nicer.md as the default app, or drops a file onto the Dock icon.
        // We extract the file path and forward it to the focused window;
        // if no window is currently focused (cold start), the event is
        // broadcast — the listener that hooks up first wins. tauri-
        // bridge.ts reads the file via tauri-plugin-fs and updates that
        // window's harness, same flow as the in-app Open dialog.
        tauri::RunEvent::Opened { urls } => {
            // OS-level Open-With / double-click / Dock drop. Two
            // distinct sub-cases:
            //   • Cold start: drained=false, no window's listener is
            //     ready. Queue the path; the first window to boot will
            //     drain and open it in-place.
            //   • Warm state: app already running, user does Open-With
            //     on a second file. Queueing and spawning a NEW window
            //     lets that file land in its own window without
            //     clobbering whatever the focused window was showing.
            //     The new window's `setupTauriBridge` boot drains the
            //     queue exactly like cold start does.
            let state = app_handle.state::<PendingOpened>();
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    // Static fs scope was dropped in 0.1.6; allow the
                    // path here so readTextFile/writeTextFile work for
                    // it in the destination window.
                    if let Err(err) = app_handle.fs_scope().allow_file(&path) {
                        log::error!("failed to allow opened path {path:?}: {err}");
                    }
                    let path_str = path.to_string_lossy().to_string();
                    // Push under the mutex, then read `drained` under
                    // the same critical section to decide whether to
                    // spawn a fresh window. Pairs with
                    // `drain_pending_opened` which flips drained under
                    // the same lock.
                    let mut paths_guard = state.paths.lock().unwrap();
                    paths_guard.push(path_str);
                    let was_drained = state.drained.load(Ordering::Acquire);
                    drop(paths_guard);
                    if was_drained {
                        if let Err(err) = create_window(app_handle) {
                            log::error!(
                                "failed to spawn window for opened path: {err}; \
                                 falling back to focused-window emit"
                            );
                            // Recover the path we just queued and emit
                            // to the focused window — better than
                            // silently losing it. If multiple paths
                            // are queued from this batch, only the
                            // most-recent one is recoverable here;
                            // earlier ones get drained by whatever
                            // window happens to boot next.
                            let recovered = state.paths.lock().unwrap().pop();
                            if let Some(p) = recovered {
                                emit_to_focused_or_all(
                                    app_handle,
                                    "menu:file-open-path",
                                    p,
                                );
                            }
                        }
                    }
                }
            }
        }
        // With multi-window enabled, the red X closes ONE window — it
        // doesn't quit the app. We only call `app.exit(0)` when the
        // last window closes; until then the runtime lets the close
        // proceed naturally (the WebviewWindow itself disposes) and
        // we just check whether any windows remain. macOS users
        // accustomed to "Cmd+W closes the window, app stays in the
        // dock with no windows" can pull that off via menu File →
        // Close Window (no special handling); when they close the
        // FINAL window, we exit so the app doesn't linger headless.
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            if app_handle.webview_windows().is_empty() {
                app_handle.exit(0);
            }
        }
        _ => {}
    });
}

// Find the currently-focused window and emit an event to it alone. If
// no window is focused (rare — e.g. macOS dock click before any window
// has come to front), broadcast to all windows. The fallback covers
// the cold-start race where OS-level Opened fires before the first
// window has finished initialising.
//
// IMPORTANT: in Tauri 2, `app.emit(...)` and `window.emit(...)` both
// broadcast to ALL listeners (the receiver doesn't bind a target).
// Scoping requires `app.emit_to(label, ...)`, which only delivers to
// listeners that registered against that label's WebviewWindow target.
// The JS-side `listen()` from `@tauri-apps/api/event` automatically
// scopes to the current window's target, so emit_to + global listen
// is the right pairing for per-window menu routing.
fn emit_to_focused_or_all<P: serde::Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: P,
) {
    let focused_label = app
        .webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    match focused_label {
        Some(label) => {
            if let Err(err) = app.emit_to(label.as_str(), event, payload) {
                log::error!("failed to emit {event} to {label}: {err}");
            }
        }
        None => {
            if let Err(err) = app.emit(event, payload) {
                log::error!("failed to emit {event}: {err}");
            }
        }
    }
}

// Spawn a new webview window with a unique label, the same URL as the
// main window, and matching chrome settings (overlay title bar, hidden
// title, decorations on). Each window mounts its own JS realm; module
// state in doc-source.ts / main.ts is therefore per-window without any
// explicit isolation work. Returns the window's label so callers can
// address it later if needed.
fn create_window(app: &AppHandle) -> tauri::Result<String> {
    let n = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("window-{n}");
    let url = WebviewUrl::App("index.html".into());
    WebviewWindowBuilder::new(app, &label, url)
        .title("Nicer.md")
        .inner_size(1100.0, 750.0)
        .min_inner_size(480.0, 320.0)
        .resizable(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .decorations(true)
        .build()?;
    Ok(label)
}

fn build_menu(
    app: &AppHandle,
) -> tauri::Result<(tauri::menu::Menu<Wry>, tauri::menu::Submenu<Wry>)> {
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
        // Custom Quit instead of PredefinedMenuItem::quit. The native
        // macOS quit (`NSApp.terminate`) bypasses each window's
        // `WindowEvent::CloseRequested` listener, so per-window dirty
        // guards in main.ts's `setupTauriCloseGuard` never fire on
        // Cmd+Q — multi-window users would silently lose unsaved work
        // in every window but the focused one. Routing through
        // `app-quit` lets `handle_menu_event` close each window via
        // `close()`, which DOES emit CloseRequested per-window so each
        // realm gets the chance to prompt. After all windows are gone
        // (or stayed open because the user cancelled), the existing
        // `WindowEvent::Destroyed` last-window check handles the exit.
        .item(
            &MenuItemBuilder::with_id("app-quit", "Quit Nicer.md")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file-new-window", "New Window")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file-new", "New Document")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file-open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file-open-url", "Open URL…")
                .accelerator("CmdOrCtrl+Alt+O")
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
            &MenuItemBuilder::with_id("view-command-palette", "Command Palette…")
                .accelerator("CmdOrCtrl+K")
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
        .item(&PredefinedMenuItem::bring_all_to_front(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Designating window_submenu as NSApp.windowsMenu must happen
    // AFTER the menu is installed on the app — caller is responsible.
    // See the `setup` block where `set_as_windows_menu_for_nsapp` is
    // called after `app.set_menu(menu)`.
    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()?;
    Ok((menu, window_submenu))
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    log::info!("menu event: {id}");

    // Most menu events should affect only the focused window so a
    // Cmd+S in window A doesn't trigger a save in window B. The one
    // exception is "New Window" — that's an app-level action that
    // creates a fresh window regardless of which one was focused.
    match id {
        "app-quit" => {
            // Close each window in turn. Each window's JS-side
            // `onCloseRequested` guard fires its own dirty check; if
            // the user cancels any window, that one stays open and the
            // rest of the cascade still proceeds. The existing
            // `WindowEvent::Destroyed` → empty → `app.exit(0)` cascade
            // handles the actual app exit once all windows are gone.
            for (_, window) in app.webview_windows() {
                if let Err(err) = window.close() {
                    log::error!("failed to close window during quit: {err}");
                }
            }
        }
        "file-new-window" => {
            if let Err(err) = create_window(app) {
                log::error!("failed to create new window: {err}");
            }
        }
        "file-new" => emit_to_focused_or_all(app, "menu:file-new", ()),
        "file-open" => emit_to_focused_or_all(app, "menu:file-open", ()),
        "file-open-url" => emit_to_focused_or_all(app, "menu:file-open-url", ()),
        "file-save" => emit_to_focused_or_all(app, "menu:file-save", ()),
        "file-save-as" => emit_to_focused_or_all(app, "menu:file-save-as", ()),
        "view-mode-1" => emit_to_focused_or_all(app, "menu:view-mode", 1),
        "view-mode-2" => emit_to_focused_or_all(app, "menu:view-mode", 2),
        "view-mode-3" => emit_to_focused_or_all(app, "menu:view-mode", 3),
        "view-mode-4" => emit_to_focused_or_all(app, "menu:view-mode", 4),
        "view-cycle-mode" => emit_to_focused_or_all(app, "menu:view-cycle", ()),
        "view-command-palette" => emit_to_focused_or_all(app, "menu:command-palette", ()),
        "view-focus" => emit_to_focused_or_all(app, "menu:view-focus-toggle", ()),
        "view-reload" => emit_to_focused_or_all(app, "menu:view-reload", ()),
        _ => {}
    }
}
