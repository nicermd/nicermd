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

use std::collections::HashMap;
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

// Per-window initial-state queue. When the focused window invokes
// `spawn_window_with_payload` (File → Duplicate Window, or right-click
// → Open Link in New Window), we pre-assign the new window's label,
// stash the payload under that label, and then build the window. The
// new window calls `drain_window_payload` on boot to consume it. Mutex
// serialises the insert vs. drain pairing across the cold→warm
// transition — the payload is inserted BEFORE the window is built, so
// even if the new window's `setupTauriBridge` raced ahead of every
// other Tauri boot step, the payload would already be findable.
// Payloads are opaque `serde_json::Value` so the Rust side stays
// schema-agnostic; the JS side defines the shape (see tauri-bridge.ts).
struct PendingWindowPayloads {
    by_label: Mutex<HashMap<String, serde_json::Value>>,
}

// Per-window dirty flag, kept in sync with each window's JS-side
// `isDirty()` via the `set_window_dirty` command. Used by the warm-
// state `RunEvent::Opened` handler to decide whether an Open-With
// file lands in the focused window (in-place replace, focused window
// is clean — user is switching docs) or in a new window (focused
// window has unsaved edits — preserve them). Without this, the
// previous behaviour spawned a new window every time, which is fine
// when dirty but unnecessary chrome when clean.
struct WindowDirty {
    by_label: Mutex<HashMap<String, bool>>,
}

#[tauri::command]
fn set_window_dirty(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WindowDirty>,
    dirty: bool,
) {
    state
        .by_label
        .lock()
        .unwrap()
        .insert(window.label().to_string(), dirty);
}

// Add `path` to the runtime fs scope so readTextFile / writeTextFile
// can touch it. Used by the per-window source-restore boot path: the
// path was previously dialog-picked or OS-opened (both auto-allowed
// at the time), but the fs scope is per-app-run since we dropped the
// static $HOME/** scope in 0.1.6 — restart needs to re-allow.
// Idempotent; safe to call any number of times.
#[tauri::command]
fn allow_fs_path(app: AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_file(std::path::Path::new(&path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn spawn_window_with_payload(
    app: AppHandle,
    state: tauri::State<'_, PendingWindowPayloads>,
    payload: serde_json::Value,
) -> Result<String, String> {
    let n = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("window-{n}");
    state.by_label.lock().unwrap().insert(label.clone(), payload);
    build_window(&app, &label).map_err(|e| e.to_string())?;
    write_live_session(&app);
    Ok(label)
}

#[tauri::command]
fn drain_window_payload(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PendingWindowPayloads>,
) -> Option<serde_json::Value> {
    state.by_label.lock().unwrap().remove(window.label())
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
        // Persist window size + position across launches. Auto-saves
        // on close, auto-restores on window-ready — so every window
        // (main + any spawned via Cmd+N / Duplicate Window / Open
        // Link in New Window) lands where the user last left it
        // without any per-window wiring on our side.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PendingOpened {
            paths: Mutex::new(Vec::new()),
            drained: AtomicBool::new(false),
        })
        .manage(PendingWindowPayloads {
            by_label: Mutex::new(HashMap::new()),
        })
        .manage(WindowDirty {
            by_label: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            drain_pending_opened,
            spawn_window_with_payload,
            drain_window_payload,
            set_window_dirty,
            allow_fs_path,
        ])
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

            // Warm-state deep-link handling. The JS-side onOpenUrl fires
            // in EVERY window's listener (the plugin uses an unscoped
            // event), so every window would race to load the URL —
            // confusing in multi-window mode. Handling here means
            // exactly one handler fires per deep link.
            //
            // Behaviour: spawn a NEW window for each deep-link URL
            // rather than replacing the focused window. Rationale:
            // "Open in Nicer.md desktop" from the extension is the
            // user reaching out FROM the browser; they don't expect
            // their current desktop state to get clobbered. (Compare
            // RunEvent::Opened which is dirty-aware — there the user
            // IS in the OS file-open context and replacement is a
            // reasonable default for clean windows.)
            //
            // Cold-start arrivals (app launch via deep link) still
            // route through the JS-side getCurrent() in
            // tauri-bridge.ts so the URL lands in the auto-spawned
            // main window rather than creating a second one.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    // The deep-link callback runs on the Tauri
                    // runtime thread, NOT the main thread. Creating
                    // a WebviewWindow on macOS requires the main
                    // thread (AppKit dispatches NSWindow allocation
                    // there) — calling build_window directly here
                    // hangs / crashes the app. Marshal each spawn
                    // into the main thread via run_on_main_thread,
                    // which is a no-op when already on main and
                    // posts to the main runloop otherwise.
                    for url in event.urls() {
                        // nicermd://?url=<encoded-target> — pull the
                        // url query param and spawn for it. Anything
                        // else (e.g. unsupported deep-link shape) is
                        // ignored silently.
                        let Some(target) = url
                            .query_pairs()
                            .find(|(k, _)| k == "url")
                            .map(|(_, v)| v.into_owned())
                        else {
                            continue;
                        };
                        let handle_for_spawn = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            let payload = serde_json::json!({
                                "kind": "fresh-url",
                                "url": target,
                            });
                            let payloads =
                                handle_for_spawn.state::<PendingWindowPayloads>();
                            let n =
                                WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
                            let label = format!("window-{n}");
                            payloads
                                .by_label
                                .lock()
                                .unwrap()
                                .insert(label.clone(), payload);
                            if let Err(err) =
                                build_window(&handle_for_spawn, &label)
                            {
                                log::error!(
                                    "deep-link: failed to spawn window: {err}"
                                );
                                // Drop the orphan payload so it
                                // doesn't accidentally drain into a
                                // future window with this label.
                                payloads
                                    .by_label
                                    .lock()
                                    .unwrap()
                                    .remove(&label);
                            } else {
                                write_live_session(&handle_for_spawn);
                            }
                        });
                    }
                });
            }

            // Session restore: re-spawn any extra windows the user
            // had open at last quit. Order matters here — we run
            // AFTER the main window is built by Tauri's bundled
            // config, so the only labels we need to recreate are the
            // non-"main" ones. The window-state plugin restores each
            // window's geometry as it boots, so by the time the user
            // sees them they're back in the same positions. Bump
            // WINDOW_COUNTER past the highest restored label so a
            // subsequent Cmd+N doesn't collide.
            let prior = read_session(app.handle());
            let mut highest: u32 = 1;
            for label in &prior.labels {
                if label == "main" {
                    continue;
                }
                if let Some(n) = label
                    .strip_prefix("window-")
                    .and_then(|s| s.parse::<u32>().ok())
                {
                    highest = highest.max(n);
                }
                if let Err(err) = build_window(app.handle(), label) {
                    log::error!("session restore: failed to spawn {label}: {err}");
                }
            }
            if highest > 1 {
                WINDOW_COUNTER.store(highest + 1, Ordering::Relaxed);
            }

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
                        // Warm state. Two routes:
                        //   • Focused window is DIRTY → spawn a new
                        //     window so the user's unsaved edits stay
                        //     untouched.
                        //   • Focused window is CLEAN (or no focused
                        //     window) → replace in-place by emitting
                        //     menu:file-open-path. Avoids piling up
                        //     windows for the "I'm done with this doc,
                        //     opening another" flow.
                        // Either way, drain the path we just pushed
                        // off the queue ourselves since this is the
                        // warm path — the cold-start drain in JS
                        // never sees these.
                        let recovered = state.paths.lock().unwrap().pop();
                        let path = match recovered {
                            Some(p) => p,
                            None => continue,
                        };
                        let focused_label = focused_window_label(app_handle);
                        let focused_dirty = focused_label
                            .as_deref()
                            .map(|l| is_window_dirty(app_handle, l))
                            .unwrap_or(false);
                        if focused_dirty {
                            if let Err(err) =
                                spawn_window_for_path(app_handle, &path)
                            {
                                log::error!(
                                    "spawn-for-path failed: {err}; \
                                     falling back to focused-window emit"
                                );
                                emit_to_focused_or_all(
                                    app_handle,
                                    "menu:file-open-path",
                                    path,
                                );
                            }
                        } else if let Some(label) = focused_label {
                            if let Err(err) = app_handle.emit_to(
                                label.as_str(),
                                "menu:file-open-path",
                                path.clone(),
                            ) {
                                log::error!("emit_to {label} failed: {err}");
                                // Last-resort fallback: spawn a window.
                                let _ = spawn_window_for_path(app_handle, &path);
                            }
                        } else {
                            // No focused window — spawn one and feed
                            // it the path via the pending queue.
                            if let Err(err) =
                                spawn_window_for_path(app_handle, &path)
                            {
                                log::error!("spawn-for-path failed: {err}");
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
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            // Drop the per-window dirty entry — stale entries would
            // confuse future Open-With routing if a label happened
            // to be reused (it shouldn't with the WINDOW_COUNTER,
            // but the cleanup is cheap defence).
            let dirty_state = app_handle.state::<WindowDirty>();
            dirty_state.by_label.lock().unwrap().remove(&label);

            // Update live session manifest so the next launch only
            // re-spawns windows that are STILL open — explicitly
            // closed windows stay closed (matches Mac conventions
            // where a Cmd+W'd window doesn't resurrect on relaunch).
            // The quit-snapshot file (if present) takes priority on
            // restore, so this update doesn't clobber a Cmd+Q-captured
            // session when destroys fire during the close cascade.
            write_live_session(app_handle);

            if app_handle.webview_windows().is_empty() {
                app_handle.exit(0);
            }
        }
        _ => {}
    });
}

// Session persistence: which windows were open at last quit. The
// tauri-plugin-window-state plugin handles per-label geometry, but
// nothing re-creates the windows on launch — only the main window
// auto-spawns from tauri.conf.json. We track the set of currently-
// open labels ourselves and re-spawn them in setup() so the full
// multi-window arrangement comes back, not just the focused window.
//
// Two files, two purposes:
//
// • session-live.json — continuously updated on every window
//   create + destroy. Represents the current set of open windows.
//   Used as the fallback restore source for crashes / force-quits
//   where no clean shutdown happened.
// • session-at-quit.json — written exactly once per app-quit
//   transaction, BEFORE the close cascade fires. Captures the
//   "what was open when the user pressed Cmd+Q" state, which the
//   subsequent destroys would otherwise overwrite as windows
//   close one by one.
//
// On startup, prefer session-at-quit.json (and delete it after
// reading) over session-live.json. This lets Cmd+W'd individual
// windows update live.json normally without being resurrected on
// the next clean quit cycle.

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct SessionLabels {
    labels: Vec<String>,
}

fn live_session_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("session-live.json"))
}

fn quit_snapshot_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("session-at-quit.json"))
}

fn read_labels_from(path: &std::path::Path) -> Option<SessionLabels> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_labels_to(path: &std::path::Path, labels: SessionLabels) {
    if let Some(parent) = path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            log::error!("session write: failed to mkdir {parent:?}: {err}");
            return;
        }
    }
    match serde_json::to_string(&labels) {
        Ok(text) => {
            if let Err(err) = std::fs::write(path, text) {
                log::error!("session write: failed to write {path:?}: {err}");
            }
        }
        Err(err) => log::error!("session write: serialise failed: {err}"),
    }
}

fn current_labels(app: &AppHandle) -> SessionLabels {
    let labels: Vec<String> = app
        .webview_windows()
        .into_iter()
        .map(|(label, _)| label)
        .collect();
    SessionLabels { labels }
}

fn write_live_session(app: &AppHandle) {
    if let Some(path) = live_session_path(app) {
        write_labels_to(&path, current_labels(app));
    }
}

fn write_quit_snapshot(app: &AppHandle) {
    if let Some(path) = quit_snapshot_path(app) {
        write_labels_to(&path, current_labels(app));
    }
}

// Resolve the session to restore on startup. Quit snapshot wins if
// present (most recent clean shutdown); falls back to the live file
// (handles crashes / force-quits). After reading, the quit snapshot
// is consumed so a subsequent crash doesn't replay an old session.
fn read_session(app: &AppHandle) -> SessionLabels {
    if let Some(quit_path) = quit_snapshot_path(app) {
        if let Some(prior) = read_labels_from(&quit_path) {
            let _ = std::fs::remove_file(&quit_path);
            return prior;
        }
    }
    if let Some(live_path) = live_session_path(app) {
        if let Some(prior) = read_labels_from(&live_path) {
            return prior;
        }
    }
    SessionLabels::default()
}

fn focused_window_label(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

fn is_window_dirty(app: &AppHandle, label: &str) -> bool {
    let state = app.state::<WindowDirty>();
    let map = state.by_label.lock().unwrap();
    map.get(label).copied().unwrap_or(false)
}

// Spawn a new window and queue `path` on the PendingOpened cache so
// the new window's drain_pending_opened picks it up during boot.
// We don't touch `drained` — drain_pending_opened collects whatever's
// in the queue regardless, and resetting drained would just risk
// confusing concurrent Opened events.
fn spawn_window_for_path(app: &AppHandle, path: &str) -> tauri::Result<()> {
    let state = app.state::<PendingOpened>();
    state.paths.lock().unwrap().push(path.to_string());
    create_window(app)?;
    Ok(())
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
    build_window(app, &label)?;
    write_live_session(app);
    Ok(label)
}

// Inner builder. Used by both `create_window` (label auto-assigned)
// and `spawn_window_with_payload` (label pre-assigned so the payload
// can be stashed under it BEFORE the new window's bridge has a chance
// to drain).
fn build_window(app: &AppHandle, label: &str) -> tauri::Result<()> {
    let url = WebviewUrl::App("index.html".into());
    WebviewWindowBuilder::new(app, label, url)
        .title("Nicer.md")
        .inner_size(1100.0, 750.0)
        .min_inner_size(480.0, 320.0)
        .resizable(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .decorations(true)
        .build()?;
    Ok(())
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
            &MenuItemBuilder::with_id("file-duplicate-window", "Duplicate Window")
                .accelerator("CmdOrCtrl+Shift+D")
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
        // Custom instead of PredefinedMenuItem::bring_all_to_front.
        // Tauri 2 / muda's predefined item is broken for windows that
        // use TitleBarStyle::Overlay: those windows aren't picked up by
        // NSApp.arrangeInFront, so clicking the menu item silently does
        // nothing. The custom handler iterates every webview window
        // ourselves and explicitly unminimises + shows + focuses each,
        // which matches user intent regardless of titlebar style.
        .item(
            &MenuItemBuilder::with_id("window-bring-all-to-front", "Bring All to Front")
                .build(app)?,
        )
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
            // Snapshot the open windows BEFORE the close cascade
            // overwrites the live session file. The next launch reads
            // this snapshot to restore the multi-window arrangement;
            // see read_session() priority order. If the user cancels
            // a dirty prompt mid-cascade, the snapshot stays on disk
            // until the next clean Cmd+Q rewrites it — acceptable
            // staleness for a brief window.
            write_quit_snapshot(app);
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
        "file-duplicate-window" => {
            // Routed to the focused window so it can read its current
            // doc state (text, name, source kind/value, content kind,
            // dirty flag) and call spawn_window_with_payload itself —
            // Rust has no view into the JS-side doc state.
            emit_to_focused_or_all(app, "menu:file-duplicate-window", ())
        }
        "file-save" => emit_to_focused_or_all(app, "menu:file-save", ()),
        "file-save-as" => emit_to_focused_or_all(app, "menu:file-save-as", ()),
        "window-bring-all-to-front" => {
            // Predefined::bring_all_to_front is a no-op for overlay-
            // titlebar windows (they aren't part of the NSApp window
            // group that arrangeInFront sweeps). Do it ourselves:
            // unminimise hidden windows, show ordered, and focus the
            // last one so the user lands somewhere predictable.
            // Errors during the per-window calls are logged but don't
            // abort — one failed window shouldn't strand the rest.
            for (label, window) in app.webview_windows() {
                if let Err(err) = window.unminimize() {
                    log::error!("bring-all: unminimize {label} failed: {err}");
                }
                if let Err(err) = window.show() {
                    log::error!("bring-all: show {label} failed: {err}");
                }
                if let Err(err) = window.set_focus() {
                    log::error!("bring-all: set_focus {label} failed: {err}");
                }
            }
        }
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
