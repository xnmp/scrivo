mod commands;
mod document_io;
#[cfg(target_os = "linux")]
mod prewarm;
mod startup;
mod trace;
mod view;
mod watch;

use std::path::Path;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// WebKitGTK's DMA-BUF renderer aborts with "Error 71 (Protocol error)" on several
/// Wayland compositor + GPU driver combinations (reproduced on Hyprland + NVIDIA 610).
/// The shared-memory fallback costs one extra copy per frame, which is invisible for a
/// text editor, so it is the default. An explicit user setting always wins.
///
/// Must run before any thread is spawned (it mutates the process environment).
#[cfg(target_os = "linux")]
fn configure_webkit_env() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: called first thing in `run`, before Tauri/GTK start any threads.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
}

/// Same format as the frontend's `windowTitle`, so the title doesn't flash on load.
fn initial_title(path: Option<&Path>) -> String {
    let name = path
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".into());
    format!("{name} — Scrivo")
}

pub fn run() {
    #[cfg(target_os = "linux")]
    configure_webkit_env();
    trace::init();
    trace::mark("process start");
    #[cfg(target_os = "linux")]
    prewarm::start();

    let startup = startup::Startup::prefetch(startup::parse_args(std::env::args_os()));
    let title = initial_title(startup.args.path.as_deref());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(startup)
        .manage(watch::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_document,
            commands::write_document,
            commands::stat_document,
            commands::startup_document,
            commands::startup_view,
            commands::render_file,
            commands::render_markdown,
            commands::trace_mark,
            watch::watch_document,
        ])
        .setup(move |app| {
            trace::mark("tauri setup");
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(&title)
                .inner_size(1100.0, 800.0)
                .min_inner_size(360.0, 240.0);
            if trace::enabled() {
                window = window.initialization_script("window.__SCRIVO_TRACE__ = true;");
            }
            window.build()?;
            trace::mark("window built");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running scrivo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_title_matches_frontend_format() {
        assert_eq!(initial_title(Some(Path::new("/a/b/notes.md"))), "notes.md — Scrivo");
        assert_eq!(initial_title(None), "Untitled — Scrivo");
    }
}
