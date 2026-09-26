//! Reading and atomically writing documents. No Tauri types here: everything is
//! plain std so it can be unit-tested against a temp directory.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

/// What we last observed about a file. Equality means "unchanged since then".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    /// Modification time in ms since the epoch, with sub-millisecond precision.
    pub mtime_ms: f64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadDocument {
    pub path: String,
    pub text: String,
    pub stamp: FileStamp,
}

#[derive(Debug, thiserror::Error)]
pub enum DocError {
    #[error("not found")]
    NotFound,
    #[error("permission denied")]
    PermissionDenied,
    #[error("not valid UTF-8")]
    NotUtf8,
    #[error("is a directory")]
    IsDirectory,
    #[error("changed on disk")]
    Conflict,
    #[error("{0}")]
    Io(io::Error),
}

impl DocError {
    /// Stable code shared with the frontend's `FileErrorCode`.
    pub fn code(&self) -> &'static str {
        match self {
            DocError::NotFound => "not-found",
            DocError::PermissionDenied => "permission-denied",
            DocError::NotUtf8 => "not-utf8",
            DocError::IsDirectory => "is-directory",
            DocError::Conflict => "conflict",
            DocError::Io(_) => "io",
        }
    }
}

impl From<io::Error> for DocError {
    fn from(e: io::Error) -> Self {
        match e.kind() {
            io::ErrorKind::NotFound => DocError::NotFound,
            io::ErrorKind::PermissionDenied => DocError::PermissionDenied,
            io::ErrorKind::IsADirectory => DocError::IsDirectory,
            _ => DocError::Io(e),
        }
    }
}

fn stamp_of(meta: &fs::Metadata) -> FileStamp {
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as f64 * 1000.0 + f64::from(d.subsec_nanos()) / 1_000_000.0)
        .unwrap_or(0.0);
    FileStamp { mtime_ms, size: meta.len() }
}

/// `path` made absolute (without resolving symlinks, so titles show what the user opened).
pub fn absolute(path: &Path) -> io::Result<PathBuf> {
    std::path::absolute(path)
}

pub fn read_document(path: &Path) -> Result<ReadDocument, DocError> {
    let path = absolute(path)?;
    let meta = fs::metadata(&path)?;
    if meta.is_dir() {
        return Err(DocError::IsDirectory);
    }
    let bytes = fs::read(&path)?;
    // Stamp from the same moment as the bytes as closely as we can: re-stat after
    // reading so a write racing with our read is seen as a change later, not lost.
    let stamp = stamp_of(&fs::metadata(&path)?);
    let text = String::from_utf8(bytes).map_err(|_| DocError::NotUtf8)?;
    Ok(ReadDocument { path: path.to_string_lossy().into_owned(), text, stamp })
}

pub fn stat_document(path: &Path) -> Result<Option<FileStamp>, DocError> {
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => Err(DocError::IsDirectory),
        Ok(meta) => Ok(Some(stamp_of(&meta))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Replace `path` with `text` so that readers see either the old or the new content,
/// never a partial file.
///
/// - Symlinks are followed: the link's target is replaced and the link survives.
/// - The existing file's permissions are kept.
/// - With `expected`, the write is refused (`Conflict`) if the file on disk no longer
///   matches it — including when it has been deleted.
///
/// Caveat: a replaced file gets a new inode, so other hard links keep the old content.
pub fn write_document(path: &Path, text: &str, expected: Option<FileStamp>) -> Result<FileStamp, DocError> {
    let path = absolute(path)?;
    let target = match fs::canonicalize(&path) {
        Ok(resolved) => resolved,
        Err(e) if e.kind() == io::ErrorKind::NotFound => path.clone(),
        Err(e) => return Err(e.into()),
    };
    let existing = match fs::metadata(&target) {
        Ok(meta) if meta.is_dir() => return Err(DocError::IsDirectory),
        Ok(meta) => Some(meta),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    if let Some(expected) = expected {
        match &existing {
            Some(meta) if stamp_of(meta) == expected => {}
            _ => return Err(DocError::Conflict),
        }
    }

    let dir = target.parent().ok_or_else(|| DocError::Io(io::Error::other("path has no parent directory")))?;
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

    let (tmp_path, mut tmp) = match create_temp(dir, &name) {
        Ok(created) => created,
        // A writable file in a directory we can't create files in: fall back to an
        // in-place write rather than refusing to save at all.
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied && existing.is_some() => {
            return write_in_place(&target, text);
        }
        Err(e) => return Err(e.into()),
    };

    let result = (|| -> io::Result<()> {
        tmp.write_all(text.as_bytes())?;
        if let Some(meta) = &existing {
            fs::set_permissions(&tmp_path, meta.permissions())?;
        }
        tmp.sync_all()?;
        drop(tmp);
        fs::rename(&tmp_path, &target)?;
        sync_dir(dir);
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.into());
    }
    Ok(stamp_of(&fs::metadata(&target)?))
}

fn create_temp(dir: &Path, name: &str) -> io::Result<(PathBuf, File)> {
    loop {
        let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let candidate = dir.join(format!(".{name}.scrivo-{}-{seq}.tmp", std::process::id()));
        // create_new never follows or clobbers a pre-existing path (including a symlink
        // planted at the temp name).
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
}

fn write_in_place(target: &Path, text: &str) -> Result<FileStamp, DocError> {
    let mut file = OpenOptions::new().write(true).truncate(true).open(target)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    Ok(stamp_of(&fs::metadata(target)?))
}

/// Make the rename durable. Best effort: not every platform/filesystem supports it.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn reads_text_and_stamp() {
        let d = tmp();
        let p = d.path().join("a.md");
        fs::write(&p, "# hi\r\n").unwrap();
        let doc = read_document(&p).unwrap();
        assert_eq!(doc.text, "# hi\r\n");
        assert_eq!(doc.stamp.size, 6);
        assert_eq!(Some(doc.stamp), stat_document(&p).unwrap());
    }

    #[test]
    fn read_errors_are_classified() {
        let d = tmp();
        assert!(matches!(read_document(&d.path().join("missing.md")), Err(DocError::NotFound)));
        assert!(matches!(read_document(d.path()), Err(DocError::IsDirectory)));
        let bin = d.path().join("bin.md");
        fs::write(&bin, [0xff, 0xfe, 0x00, 0x41]).unwrap();
        assert!(matches!(read_document(&bin), Err(DocError::NotUtf8)));
    }

    #[test]
    fn stat_of_missing_file_is_none() {
        assert_eq!(stat_document(&tmp().path().join("nope")).unwrap(), None);
    }

    #[test]
    fn creates_and_replaces_files_without_leaving_temp_files() {
        let d = tmp();
        let p = d.path().join("a.md");
        let s1 = write_document(&p, "one", None).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "one");
        let s2 = write_document(&p, "two", Some(s1)).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(Some(s2), stat_document(&p).unwrap());
        let names: Vec<_> = fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("a.md")]);
    }

    #[test]
    fn refuses_to_clobber_external_changes() {
        let d = tmp();
        let p = d.path().join("a.md");
        let stale = write_document(&p, "mine", None).unwrap();
        fs::write(&p, "theirs, and longer").unwrap();
        assert!(matches!(write_document(&p, "mine v2", Some(stale)), Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "theirs, and longer");
    }

    #[test]
    fn expected_stamp_on_a_deleted_file_is_a_conflict() {
        let d = tmp();
        let p = d.path().join("a.md");
        let s = write_document(&p, "x", None).unwrap();
        fs::remove_file(&p).unwrap();
        assert!(matches!(write_document(&p, "y", Some(s)), Err(DocError::Conflict)));
        assert!(!p.exists());
    }

    #[test]
    fn missing_parent_directory_is_not_found() {
        let d = tmp();
        let p = d.path().join("no/such/dir/a.md");
        assert!(matches!(write_document(&p, "x", None), Err(DocError::NotFound)));
    }

    #[test]
    fn writing_to_a_directory_fails() {
        let d = tmp();
        assert!(matches!(write_document(d.path(), "x", None), Err(DocError::IsDirectory)));
    }

    #[cfg(unix)]
    #[test]
    fn keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let p = d.path().join("a.md");
        fs::write(&p, "x").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
        write_document(&p, "y", None).unwrap();
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[cfg(unix)]
    #[test]
    fn writes_through_symlinks_and_keeps_the_link() {
        let d = tmp();
        let real = d.path().join("real.md");
        let link = d.path().join("link.md");
        fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let s = read_document(&link).unwrap().stamp;
        write_document(&link, "new", Some(s)).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn falls_back_to_in_place_write_in_read_only_directories() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let dir = d.path().join("ro");
        fs::create_dir(&dir).unwrap();
        let p = dir.join("a.md");
        fs::write(&p, "old").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let result = write_document(&p, "new", None);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        // Running as root bypasses directory permissions; either way the content lands.
        result.unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_write_leaves_the_original_intact() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let dir = d.path().join("ro");
        fs::create_dir(&dir).unwrap();
        let p = dir.join("a.md");
        fs::write(&p, "precious").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let result = write_document(&p, "clobber", None);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        if result.is_err() {
            assert_eq!(fs::read_to_string(&p).unwrap(), "precious");
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]
        #[test]
        fn round_trips_arbitrary_text(text in "\\PC*", crlf in any::<bool>()) {
            let text = if crlf { text.replace('\n', "\r\n") } else { text };
            let d = tmp();
            let p = d.path().join("doc.md");
            let stamp = write_document(&p, &text, None).unwrap();
            let doc = read_document(&p).unwrap();
            prop_assert_eq!(doc.text, text);
            prop_assert_eq!(doc.stamp, stamp);
        }
    }
}
