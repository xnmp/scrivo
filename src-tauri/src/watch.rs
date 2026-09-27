//! Watch the parent directory, not the file inode: editors commonly save by
//! replacing a file, which would leave an inode watch attached to the old file.
use notify::{RecursiveMode, Watcher};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::commands::CommandError;
use crate::document_io;

#[derive(Default)]
pub struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

fn parents(path: &Path) -> std::io::Result<HashSet<PathBuf>> {
    let absolute = document_io::absolute(path)?;
    let resolved = fs::canonicalize(&absolute).unwrap_or_else(|_| absolute.clone());
    Ok([absolute.parent(), resolved.parent()]
        .into_iter()
        .flatten()
        .map(Path::to_path_buf)
        .collect())
}

#[tauri::command]
pub fn watch_document(
    app: AppHandle,
    state: State<'_, WatchState>,
    path: Option<String>,
) -> Result<(), CommandError> {
    let next = if let Some(path) = path {
        let watched_path = path.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if event.is_ok() {
                    // Notifications are hints. The frontend stats the current path and
                    // compares stamps before reloading or prompting.
                    let _ = app.emit("document-changed", &watched_path);
                }
            })
            .map_err(|e| CommandError::internal(e))?;
        for dir in parents(Path::new(&path)).map_err(CommandError::internal)? {
            watcher
                .watch(&dir, RecursiveMode::NonRecursive)
                .map_err(CommandError::internal)?;
        }
        Some(watcher)
    } else {
        None
    };
    *state
        .0
        .lock()
        .map_err(|e| CommandError::internal(e.to_string()))? = next;
    Ok(())
}
