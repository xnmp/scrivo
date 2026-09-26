//! Thin IPC adapters over `document_io`. Blocking file work runs on the blocking pool
//! so the main thread (and with it, window events) never waits on the disk.

use crate::document_io::{self, DocError, FileStamp, ReadDocument};
use crate::startup::{Startup, StartupDocument, StartupView};
use crate::view::{self, ViewDocument};
use crate::trace;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl From<DocError> for CommandError {
    fn from(e: DocError) -> Self {
        CommandError { code: e.code(), message: e.to_string() }
    }
}

fn internal(message: impl ToString) -> CommandError {
    CommandError { code: "io", message: message.to_string() }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, DocError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(internal)?.map_err(Into::into)
}

/// Let the webview load images that sit next to (or below) an open document.
fn allow_assets_near(app: &AppHandle, document: &str) {
    if let Some(dir) = Path::new(document).parent() {
        let _ = app.asset_protocol_scope().allow_directory(dir, true);
    }
}

/// Let the webview load exactly the local images a rendered document shows.
fn allow_images(app: &AppHandle, doc: &ViewDocument) {
    let scope = app.asset_protocol_scope();
    for image in &doc.local_images {
        let _ = scope.allow_file(image);
    }
}

#[tauri::command]
pub async fn read_document(app: AppHandle, path: String) -> Result<ReadDocument, CommandError> {
    let doc = blocking(move || document_io::read_document(Path::new(&path))).await?;
    allow_assets_near(&app, &doc.path);
    Ok(doc)
}

#[tauri::command]
pub async fn write_document(
    app: AppHandle,
    path: String,
    text: String,
    expected: Option<FileStamp>,
) -> Result<FileStamp, CommandError> {
    let target = path.clone();
    let stamp = blocking(move || document_io::write_document(Path::new(&target), &text, expected)).await?;
    allow_assets_near(&app, &path);
    Ok(stamp)
}

#[tauri::command]
pub async fn stat_document(path: String) -> Result<Option<FileStamp>, CommandError> {
    blocking(move || document_io::stat_document(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn startup_document(app: AppHandle, startup: State<'_, Startup>) -> Result<StartupDocument, CommandError> {
    let doc = startup.document();
    trace::mark("startup document delivered");
    match &doc {
        StartupDocument::File { file } => allow_assets_near(&app, &file.path),
        StartupDocument::New { path } => allow_assets_near(&app, path),
        _ => {}
    }
    Ok(doc)
}

/// What to show first: the prefetched, rendered document or "start the editor".
#[tauri::command]
pub async fn startup_view(app: AppHandle, startup: State<'_, Startup>) -> Result<StartupView, CommandError> {
    let view = startup.view();
    trace::mark("startup view delivered");
    if let StartupView::View { document } = &view {
        allow_images(&app, document);
    }
    Ok(view)
}

/// Read and render a file for the reading view.
#[tauri::command]
pub async fn render_file(app: AppHandle, path: String) -> Result<ViewDocument, CommandError> {
    let doc = blocking(move || document_io::read_document(Path::new(&path)).map(|file| view::render_document(&file))).await?;
    allow_images(&app, &doc);
    Ok(doc)
}

/// Render text (e.g. the editor's unsaved buffer) as if it were the file at `path`.
#[tauri::command]
pub async fn render_markdown(app: AppHandle, text: String, path: Option<String>) -> Result<ViewDocument, CommandError> {
    let doc = blocking(move || Ok(view::render_text(&text, path.as_deref()))).await?;
    allow_images(&app, &doc);
    Ok(doc)
}

/// Frontend timing marks, printed only with SCRIVO_TRACE=1.
#[tauri::command]
pub fn trace_mark(label: String) {
    trace::mark(&label);
}
