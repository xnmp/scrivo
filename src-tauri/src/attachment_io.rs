//! Collision-safe attachment copies next to a Markdown document.
//! No Tauri types live here, so file behavior is exercised with real temp files.

use crate::document_io::{self, DocError, FileStamp};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

const MAX_ATTEMPTS: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAttachment {
    pub file_name: String,
    pub stamp: FileStamp,
}

fn assets_dir(document: &Path) -> Result<PathBuf, DocError> {
    let document = document_io::absolute(document)?;
    document_io::stat_document(&document)?.ok_or(DocError::NotFound)?;
    let parent = document.parent().ok_or_else(|| io::Error::other("document has no parent directory"))?;
    let dir = parent.join("assets");
    match fs::create_dir(&dir) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    let metadata = fs::symlink_metadata(&dir)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(DocError::Io(io::Error::other("assets is not a regular directory")));
    }
    Ok(dir)
}

fn mime_extension(mime: &str) -> Option<&'static str> {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "image/bmp" => Some("bmp"),
        "image/svg+xml" => Some("svg"),
        "application/pdf" => Some("pdf"),
        _ => None,
    }
}

fn safe_name(requested: &str, mime: &str) -> String {
    let cleaned: String = requested.chars()
        .map(|ch| if ch.is_control() || "<>:\"/\\|?*".contains(ch) { '_' } else { ch })
        .take(120)
        .collect();
    let mut name = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() || name == "." || name == ".." { name = "attachment".into(); }
    // Clipboard images often arrive with a generic name lacking an extension.
    if !name.contains('.') && let Some(extension) = mime_extension(mime) {
        name.push('.');
        name.push_str(extension);
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9") {
        name.insert(0, '_');
    }
    name
}

fn candidate_name(base: &str, attempt: usize) -> String {
    if attempt == 0 { return base.to_string(); }
    let split = base.rfind('.').filter(|&i| i > 0).unwrap_or(base.len());
    let (stem, extension) = base.split_at(split);
    format!("{stem}-{}{extension}", attempt + 1)
}

fn import_reader(document: &Path, name: &str, mime: &str, mut source: impl Read) -> Result<ImportedAttachment, DocError> {
    let dir = assets_dir(document)?;
    let base = safe_name(name, mime);
    for attempt in 0..MAX_ATTEMPTS {
        let file_name = candidate_name(&base, attempt);
        let path = dir.join(&file_name);
        let mut output = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        let written = (|| -> io::Result<()> {
            io::copy(&mut source, &mut output)?;
            output.flush()?;
            output.sync_all()?;
            Ok(())
        })();
        drop(output);
        if let Err(error) = written {
            let _ = fs::remove_file(&path);
            return Err(error.into());
        }
        #[cfg(unix)]
        File::open(&dir)?.sync_all()?;
        let stamp = document_io::stat_document(&path)?.ok_or(DocError::Conflict)?;
        return Ok(ImportedAttachment { file_name, stamp });
    }
    Err(DocError::Io(io::Error::other("too many attachments with the same name")))
}

pub fn import_bytes(document: &Path, name: &str, mime: &str, bytes: &[u8]) -> Result<ImportedAttachment, DocError> {
    import_reader(document, name, mime, bytes)
}

pub fn import_path(document: &Path, source: &Path) -> Result<ImportedAttachment, DocError> {
    let file = File::open(source)?;
    if !file.metadata()?.is_file() { return Err(DocError::IsDirectory); }
    let name = source.file_name().ok_or(DocError::NotFound)?.to_string_lossy();
    import_reader(document, &name, "", file)
}

/// Remove only the exact fresh file recorded by an import that could not be linked.
pub fn rollback(document: &Path, imported: &ImportedAttachment) -> Result<(), DocError> {
    if imported.file_name.is_empty() || imported.file_name == "." || imported.file_name == ".."
        || imported.file_name.chars().any(|ch| ch.is_control() || ch == '/' || ch == '\\') {
        return Err(DocError::Conflict);
    }
    let path = assets_dir(document)?.join(&imported.file_name);
    if document_io::stat_document(&path)? != Some(imported.stamp.clone()) {
        return Err(DocError::Conflict);
    }
    fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn imports_bytes_with_unicode_name_without_overwriting_a_collision() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, b"# note\n").unwrap();
        let one = import_bytes(&doc, "café photo.png", "image/png", b"first").unwrap();
        let two = import_bytes(&doc, "café photo.png", "image/png", b"second").unwrap();
        assert_eq!(one.file_name, "café photo.png");
        assert_eq!(two.file_name, "café photo-2.png");
        assert_eq!(fs::read(dir.path().join("assets").join(&one.file_name)).unwrap(), b"first");
        assert_eq!(fs::read(dir.path().join("assets").join(&two.file_name)).unwrap(), b"second");
    }

    #[test]
    fn imports_a_real_file_and_rolls_back_only_its_unchanged_copy() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        let source = dir.path().join("report.pdf");
        fs::write(&doc, b"").unwrap();
        fs::write(&source, b"PDF bytes").unwrap();
        let result = import_path(&doc, &source).unwrap();
        let imported = dir.path().join("assets").join(&result.file_name);
        assert_eq!(fs::read(&imported).unwrap(), b"PDF bytes");
        fs::write(&imported, b"changed").unwrap();
        assert!(matches!(rollback(&doc, &result), Err(DocError::Conflict)));
        assert_eq!(fs::read(&imported).unwrap(), b"changed");
    }

    #[test]
    fn rejects_directories_and_a_symlinked_assets_directory() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, b"").unwrap();
        assert!(matches!(import_path(&doc, dir.path()), Err(DocError::IsDirectory)));
        #[cfg(unix)] {
            std::os::unix::fs::symlink(dir.path(), dir.path().join("assets")).unwrap();
            assert!(import_bytes(&doc, "x.png", "image/png", b"x").is_err());
            assert!(!dir.path().join("x.png").exists());
        }
    }

    #[test]
    fn sanitizes_untrusted_clipboard_filenames() {
        assert_eq!(safe_name("../CON?.png", "image/png"), ".._CON_.png");
        assert_eq!(safe_name("", "image/png"), "attachment.png");
        assert_eq!(safe_name("image", "image/jpeg"), "image.jpg");
    }
}
