//! Thin IPC adapters over `document_io`. Blocking file work runs on the blocking pool
//! so the main thread (and with it, window events) never waits on the disk.

use crate::document_io::{self, DocError, FileStamp, ReadDocument, WriteCondition};
use crate::recovery::{self, RecoveryCopy};
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

impl CommandError {
    pub fn internal(message: impl ToString) -> Self {
        Self { code: "io", message: message.to_string() }
    }
}

impl From<DocError> for CommandError {
    fn from(e: DocError) -> Self {
        CommandError { code: e.code(), message: e.to_string() }
    }
}

fn internal(message: impl ToString) -> CommandError {
    CommandError::internal(message)
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

/// Keep the first safe renderer chunk in the initial response. Small tails stay
/// in one response; a second IPC would cost more than it saves for them.
fn preview_document(mut document: ViewDocument) -> (ViewDocument, bool) {
    const MIN_TAIL_BYTES: usize = 64 * 1024;
    let Some(end) = document.chunk_ends.first().and_then(|&offset| byte_at_utf16(&document.html, offset)) else {
        return (document, false);
    };
    if document.html.len() - end < MIN_TAIL_BYTES {
        return (document, false);
    }
    document.html.truncate(end);
    document.chunk_ends.clear();
    (document, true)
}

fn byte_at_utf16(text: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units == offset { return Some(byte); }
        units += ch.len_utf16();
        if units > offset { return None; }
    }
    (units == offset).then_some(text.len())
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartupPreview {
    View { document: ViewDocument, #[serde(rename = "hasTail")] has_tail: bool },
    Edit,
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
    condition: WriteCondition,
) -> Result<FileStamp, CommandError> {
    let target = path.clone();
    let stamp = blocking(move || document_io::write_document(Path::new(&target), &text, condition)).await?;
    allow_assets_near(&app, &path);
    Ok(stamp)
}

#[tauri::command]
pub async fn stat_document(path: String) -> Result<Option<FileStamp>, CommandError> {
    blocking(move || document_io::stat_document(&PathBuf::from(path))).await
}

fn recovery_root(app: &AppHandle) -> Result<PathBuf, CommandError> {
    Ok(app.path().app_data_dir().map_err(internal)?.join("recovery"))
}

#[tauri::command]
pub async fn list_recovery(app: AppHandle) -> Result<Vec<RecoveryCopy>, CommandError> {
    let root = recovery_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || recovery::list(&root))
        .await.map_err(internal)?.map_err(internal)
}

#[tauri::command]
pub async fn put_recovery(app: AppHandle, copy: RecoveryCopy) -> Result<(), CommandError> {
    let root = recovery_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || recovery::put(&root, &copy))
        .await.map_err(internal)?.map_err(internal)
}

#[tauri::command]
pub async fn remove_recovery(app: AppHandle, id: String) -> Result<(), CommandError> {
    let root = recovery_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || recovery::remove(&root, &id))
        .await.map_err(internal)?.map_err(internal)
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
    trace::mark("startup view command entered");
    let view = startup.view();
    trace::mark("startup view cloned");
    trace::mark("startup view delivered");
    if let StartupView::View { document } = &view {
        allow_images(&app, document);
    }
    Ok(view)
}

/// The first complete renderer chunk, with a later full response for large files.
#[tauri::command]
pub async fn startup_preview(app: AppHandle, startup: State<'_, Startup>) -> Result<StartupPreview, CommandError> {
    let view = startup.view();
    match view {
        StartupView::View { document } => {
            allow_images(&app, &document);
            let (document, has_tail) = preview_document(document);
            Ok(StartupPreview::View { document, has_tail })
        }
        StartupView::Edit => Ok(StartupPreview::Edit),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_ends_at_a_unicode_safe_chunk_boundary_and_keeps_metadata() {
        let first = "<p>😀 café</p>";
        let doc = ViewDocument {
            path: Some("/notes/😀.md".into()), stamp: None,
            html: format!("{first}{}", "x".repeat(70_000)),
            chunk_ends: vec![first.encode_utf16().count()],
            headings: vec![], local_images: vec![],
        };
        let (preview, has_tail) = preview_document(doc.clone());
        assert!(has_tail);
        assert_eq!(preview.html, first);
        assert!(preview.chunk_ends.is_empty());
        assert_eq!(preview.path, doc.path);
        assert_eq!(doc.html.len(), first.len() + 70_000);
    }

    #[test]
    fn short_or_invalid_chunk_boundaries_keep_the_complete_document() {
        let doc = ViewDocument {
            path: None, stamp: None, html: "<p>😀</p>".into(),
            chunk_ends: vec![4], headings: vec![], local_images: vec![],
        };
        let (preview, has_tail) = preview_document(doc.clone());
        assert!(!has_tail);
        assert_eq!(preview.html, doc.html);
        let invalid = ViewDocument { html: format!("{}{}", doc.html, "x".repeat(70_000)), chunk_ends: vec![4], ..doc };
        let (preview, has_tail) = preview_document(invalid.clone());
        assert!(!has_tail);
        assert_eq!(preview.html, invalid.html);
    }
}
