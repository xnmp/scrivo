//! Reading and atomically writing documents. No Tauri types here: everything is
//! plain std so it can be unit-tested against a temp directory.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(not(any(unix, windows)))]
use std::time::UNIX_EPOCH;

/// Opaque revision token. Keep exact filesystem integers inside a JSON string so
/// JavaScript cannot round a sub-millisecond timestamp during IPC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FileStamp(String);

/// Disk state that a save may replace. Overwrite must be chosen explicitly.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteCondition {
    Unchanged { stamp: FileStamp },
    Absent,
    Overwrite,
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

#[cfg(not(windows))]
fn stamp_of(meta: &fs::Metadata) -> Result<FileStamp, DocError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(FileStamp(format!("v1:{}:{}:{}:{}:{}:{}:{}", meta.dev(), meta.ino(), meta.len(), meta.mtime(), meta.mtime_nsec(), meta.ctime(), meta.ctime_nsec())))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let time = match meta.modified()?.duration_since(UNIX_EPOCH) {
            Ok(d) => format!("after:{}:{}", d.as_secs(), d.subsec_nanos()),
            Err(e) => format!("before:{}:{}", e.duration().as_secs(), e.duration().subsec_nanos()),
        };
        Ok(FileStamp(format!("v1:{}:{time}", meta.len())))
    }
}

/// Windows keeps a metadata change time separate from last write time. Include it
/// and a file identity so common same-size rewrites and atomic replacements
/// differ even when last-write time is copied. Weak filesystems also need a hash.
#[cfg(windows)]
fn unsupported_windows_query(error: &io::Error) -> bool {
    use windows_sys::Win32::Foundation::{ERROR_INVALID_FUNCTION, ERROR_INVALID_PARAMETER, ERROR_NOT_SUPPORTED};
    matches!(error.raw_os_error().map(|code| code as u32),
        Some(ERROR_INVALID_FUNCTION | ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED))
}

#[cfg(windows)]
fn stamp_of_file(file: &File, meta: &fs::Metadata) -> Result<(FileStamp, bool), DocError> {
    use std::mem::size_of;
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_BASIC_INFO, FILE_ID_INFO, FileBasicInfo, FileIdInfo,
        GetFileInformationByHandle, GetFileInformationByHandleEx,
    };

    let handle = file.as_raw_handle();
    let mut basic = FILE_BASIC_INFO::default();
    let mut id = FILE_ID_INFO::default();
    // SAFETY: both output buffers are correctly laid out Windows API structures,
    // live for the calls, and their exact sizes are passed to the API.
    let basic_ok = unsafe {
        GetFileInformationByHandleEx(handle, FileBasicInfo, (&raw mut basic).cast(), size_of::<FILE_BASIC_INFO>() as u32)
    };
    let (last_write, change_time, missing_change_time) = if basic_ok != 0 {
        (basic.LastWriteTime as u64, basic.ChangeTime as u64, basic.ChangeTime == 0)
    } else {
        let error = io::Error::last_os_error();
        if !unsupported_windows_query(&error) { return Err(error.into()); }
        // Stable metadata still exposes the exact FILETIME last-write value.
        (meta.last_write_time(), 0, true)
    };
    let id_ok = unsafe {
        GetFileInformationByHandleEx(handle, FileIdInfo, (&raw mut id).cast(), size_of::<FILE_ID_INFO>() as u32)
    };
    if id_ok != 0 {
        let file_id = u128::from_le_bytes(id.FileId.Identifier);
        return Ok((FileStamp(format!(
            "v2:id128:{}:{file_id:032x}:{}:{}:{}",
            id.VolumeSerialNumber, meta.len(), last_write, change_time,
        )), missing_change_time));
    }
    let error = io::Error::last_os_error();
    if !unsupported_windows_query(&error) { return Err(error.into()); }
    // Some filesystems do not implement FileIdInfo. The older query still
    // provides volume + 64-bit file identity on FAT/exFAT and many remote drives.
    let mut legacy = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `legacy` is a live, correctly laid out output buffer.
    let legacy_ok = unsafe { GetFileInformationByHandle(handle, &raw mut legacy) };
    if legacy_ok == 0 {
        let error = io::Error::last_os_error();
        if !unsupported_windows_query(&error) { return Err(error.into()); }
        // A few virtual filesystems expose no file ID at all. A content hash
        // still protects conditional saves even when identity is unavailable.
        return Ok((FileStamp(format!(
            "v2:noid:{}:{}:{}:{}:{}",
            meta.creation_time(), meta.file_attributes(), meta.len(), last_write, change_time,
        )), true));
    }
    let file_id = (u64::from(legacy.nFileIndexHigh) << 32) | u64::from(legacy.nFileIndexLow);
    Ok((FileStamp(format!(
        "v2:id64:{}:{file_id:016x}:{}:{}:{}",
        legacy.dwVolumeSerialNumber, meta.len(), last_write, change_time,
    )), true))
}

#[cfg(windows)]
fn with_content_digest(stamp: FileStamp, digest: impl std::fmt::LowerHex) -> FileStamp {
    FileStamp(format!("{}:{digest:x}", stamp.0))
}

fn state_of_file(file: &File) -> Result<(fs::Metadata, FileStamp, bool), DocError> {
    let meta = file.metadata()?;
    #[cfg(windows)]
    let (stamp, needs_hash) = stamp_of_file(file, &meta)?;
    #[cfg(not(windows))]
    let stamp = stamp_of(&meta)?;
    #[cfg(not(windows))]
    let needs_hash = false;
    Ok((meta, stamp, needs_hash))
}

fn state_at_path(path: &Path) -> Result<Option<(fs::Metadata, FileStamp)>, DocError> {
    let meta = match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => return Err(DocError::IsDirectory),
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    #[cfg(windows)]
    {
        let _ = meta; // Directory classification above; the stamp uses handle metadata.
        // Query the stamp through an open handle; Windows' stable MetadataExt
        // does not expose change time or file ID.
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_READ_ATTRIBUTES;
        let file = OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES).open(path)?;
        let (meta, stamp, needs_hash) = state_of_file(&file)?;
        if meta.is_dir() { return Err(DocError::IsDirectory); }
        if !needs_hash { return Ok(Some((meta, stamp))); }

        // Some filesystems lack a strong ID or change time. Hash the actual bytes
        // so a same-size edit within one timestamp tick still changes the token.
        let mut data = File::open(path)?;
        let (meta, before, _) = state_of_file(&data)?;
        use sha2::{Digest, Sha256};
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let n = data.read(&mut buffer)?;
            if n == 0 { break; }
            digest.update(&buffer[..n]);
        }
        let (_, after, _) = state_of_file(&data)?;
        if before != after { return Err(DocError::Conflict); }
        let at_path = OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES).open(path)?;
        let (_, current, _) = state_of_file(&at_path)?;
        if after != current { return Err(DocError::Conflict); }
        Ok(Some((meta, with_content_digest(after, digest.finalize()))))
    }
    #[cfg(not(windows))]
    {
        let stamp = stamp_of(&meta)?;
        Ok(Some((meta, stamp)))
    }
}

/// `path` made absolute (without resolving symlinks, so titles show what the user opened).
pub fn absolute(path: &Path) -> io::Result<PathBuf> {
    std::path::absolute(path)
}

pub fn read_document(path: &Path) -> Result<ReadDocument, DocError> {
    let path = absolute(path)?;
    let mut file = File::open(&path)?;
    let (before, before_stamp, before_hash) = state_of_file(&file)?;
    if before.is_dir() {
        return Err(DocError::IsDirectory);
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let (_, after_stamp, after_hash) = state_of_file(&file)?;
    if before_stamp != after_stamp || before_hash != after_hash {
        return Err(DocError::Conflict);
    }
    #[cfg(windows)]
    let after_stamp = if after_hash {
        use sha2::{Digest, Sha256};
        with_content_digest(after_stamp, Sha256::digest(&bytes))
    } else { after_stamp };
    let (_, path_stamp) = state_at_path(&path)?.ok_or(DocError::Conflict)?;
    // The bytes and stamp must describe the same version of the file. A path
    // lookup after reading alone can stamp old bytes with a replacement's metadata.
    if after_stamp != path_stamp {
        return Err(DocError::Conflict);
    }
    let stamp = after_stamp;
    let text = String::from_utf8(bytes).map_err(|_| DocError::NotUtf8)?;
    Ok(ReadDocument { path: path.to_string_lossy().into_owned(), text, stamp })
}

pub fn stat_document(path: &Path) -> Result<Option<FileStamp>, DocError> {
    Ok(state_at_path(path)?.map(|(_, stamp)| stamp))
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Replace `path` with `text` so that readers see either the old or the new content,
/// never a partial file.
///
/// - Symlinks are followed: the link's target is replaced and the link survives.
/// - The existing file's permissions are kept.
/// - `Unchanged` and `Absent` refuse (`Conflict`) when disk state changed.
///
/// Caveat: a replaced file gets a new inode, so other hard links keep the old content.
pub fn write_document(path: &Path, text: &str, condition: WriteCondition) -> Result<FileStamp, DocError> {
    write_document_with(path, text, condition, || {})
}

fn write_document_with(path: &Path, text: &str, condition: WriteCondition, before_replace: impl FnOnce()) -> Result<FileStamp, DocError> {
    write_document_with_hooks(path, text, condition, before_replace, || {})
}

fn write_document_with_hooks(path: &Path, text: &str, condition: WriteCondition, before_replace: impl FnOnce(), before_rename: impl FnOnce()) -> Result<FileStamp, DocError> {
    let path = absolute(path)?;
    let target = match fs::canonicalize(&path) {
        Ok(resolved) => resolved,
        Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::symlink_metadata(&path) {
            // The path exists, but its target does not. Replacing the link itself
            // would violate the rule that saves follow and preserve symlinks.
            Ok(_) => return Err(DocError::NotFound),
            Err(e) if e.kind() == io::ErrorKind::NotFound => path.clone(),
            Err(e) => return Err(e.into()),
        },
        Err(e) => return Err(e.into()),
    };
    let existing = state_at_path(&target)?;
    let existing_stamp = existing.as_ref().map(|(_, stamp)| stamp);
    match (&condition, &existing_stamp) {
        (WriteCondition::Unchanged { stamp }, Some(observed)) if *observed == stamp => {}
        (WriteCondition::Absent, None) | (WriteCondition::Overwrite, _) => {}
        _ => return Err(DocError::Conflict),
    }

    let dir = target.parent().ok_or_else(|| DocError::Io(io::Error::other("path has no parent directory")))?;
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

    let (tmp_path, mut tmp) = create_temp(dir, &name)?;

    let result = (|| -> Result<(), DocError> {
        tmp.write_all(text.as_bytes())?;
        if let Some((meta, _)) = &existing {
            fs::set_permissions(&tmp_path, meta.permissions())?;
        }
        tmp.sync_all()?;
        drop(tmp);
        before_replace();
        // Check again after the potentially slow write. This cannot make a
        // cross-process compare-and-rename atomic, but catches changes during it.
        match &condition {
            WriteCondition::Unchanged { stamp } => {
                let (_, current_stamp) = state_at_path(&target)?.ok_or(DocError::Conflict)?;
                if &current_stamp != stamp {
                    return Err(DocError::Conflict);
                }
            }
            WriteCondition::Absent => match fs::symlink_metadata(&target) {
                Ok(_) => return Err(DocError::Conflict),
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            },
            WriteCondition::Overwrite if existing.is_none() => {
                // Even an explicit overwrite must not clobber a file that appeared
                // after the user's choice but before the temporary file was ready.
                match fs::symlink_metadata(&target) {
                    Ok(_) => return Err(DocError::Conflict),
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
            WriteCondition::Overwrite => {
                // Confirmation applies to the version observed when this write
                // began, not to a later edit or replacement by another writer.
                let (_, current_stamp) = state_at_path(&target)?.ok_or(DocError::Conflict)?;
                if existing_stamp != Some(&current_stamp) {
                    return Err(DocError::Conflict);
                }
            }
        }
        if existing.is_some() {
            match fs::canonicalize(&path) {
                Ok(current_target) if current_target == target => {}
                Ok(_) => return Err(DocError::Conflict),
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Err(DocError::Conflict),
                Err(e) => return Err(e.into()),
            }
        }
        before_rename();
        if existing.is_none() {
            install_new_target(&tmp_path, &target)?;
        } else {
            fs::rename(&tmp_path, &target)?;
        }
        sync_dir(dir);
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }
    state_at_path(&target)?.map(|(_, stamp)| stamp).ok_or(DocError::NotFound)
}

/// Install a prepared new document without replacing a path another writer
/// created after our last check. The source and destination share a directory.
fn install_new_target(source: &Path, target: &Path) -> Result<(), DocError> {
    let result = rename_no_replace(source, target);
    match result {
        Ok(()) => Ok(()),
        Err(error) => match fs::symlink_metadata(target) {
            Ok(_) => Err(DocError::Conflict),
            Err(not_found) if not_found.kind() == io::ErrorKind::NotFound => Err(error.into()),
            Err(metadata_error) => Err(metadata_error.into()),
        },
    }
}

#[cfg(target_os = "linux")]
fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source_c = CString::new(source.as_os_str().as_bytes())?;
    let target_c = CString::new(target.as_os_str().as_bytes())?;
    // SAFETY: both NUL-terminated path buffers live through the syscall.
    let result = unsafe {
        libc::renameat2(libc::AT_FDCWD, source_c.as_ptr(), libc::AT_FDCWD, target_c.as_ptr(), libc::RENAME_NOREPLACE)
    };
    if result == 0 { return Ok(()); }
    let error = io::Error::last_os_error();
    if matches!(error.raw_os_error(), Some(libc::ENOSYS | libc::EINVAL | libc::EOPNOTSUPP)) {
        return Err(atomic_new_file_unsupported());
    }
    Err(error)
}

#[cfg(target_os = "macos")]
fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source_c = CString::new(source.as_os_str().as_bytes())?;
    let target_c = CString::new(target.as_os_str().as_bytes())?;
    // SAFETY: both NUL-terminated path buffers live through the syscall.
    let result = unsafe { libc::renamex_np(source_c.as_ptr(), target_c.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 { return Ok(()); }
    let error = io::Error::last_os_error();
    if matches!(error.raw_os_error(), Some(libc::EINVAL | libc::ENOTSUP)) {
        return Err(atomic_new_file_unsupported());
    }
    Err(error)
}

#[cfg(windows)]
fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let source = windows_api_path(source)?;
    let target = windows_api_path(target)?;
    // SAFETY: both NUL-terminated UTF-16 buffers live through the API call.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0) } != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn windows_api_path(path: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    // Callers pass paths already normalized by `absolute` or `canonicalize`.
    // Mirror std's long-path threshold: short paths keep Win32 name semantics,
    // while long drive/UNC paths need an extended-length prefix for MoveFileExW.
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"));
    }
    const BACKSLASH: u16 = b'\\' as u16;
    const QUESTION: u16 = b'?' as u16;
    let verbatim = [BACKSLASH, BACKSLASH, QUESTION, BACKSLASH];
    let nt_prefix = [BACKSLASH, QUESTION, QUESTION, BACKSLASH];
    if wide.len() + 1 >= 248 && !wide.starts_with(&verbatim) && !wide.starts_with(&nt_prefix) {
        let prefix: Vec<u16> = if wide.starts_with(&[BACKSLASH, BACKSLASH, b'.' as u16, BACKSLASH]) {
            wide.drain(..4);
            "\\\\?\\".encode_utf16().collect()
        } else if wide.starts_with(&[BACKSLASH, BACKSLASH]) {
            wide.drain(..2);
            "\\\\?\\UNC\\".encode_utf16().collect()
        } else {
            "\\\\?\\".encode_utf16().collect()
        };
        wide.splice(..0, prefix);
    }
    wide.push(0);
    Ok(wide)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn rename_no_replace(_source: &Path, _target: &Path) -> io::Result<()> {
    Err(atomic_new_file_unsupported())
}

#[cfg(not(windows))]
fn atomic_new_file_unsupported() -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, "filesystem cannot atomically create a new document")
}

#[cfg(not(any(unix, windows)))]
fn rename_no_replace(_source: &Path, _target: &Path) -> io::Result<()> {
    Err(atomic_new_file_unsupported())
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
        assert_eq!(Some(doc.stamp), stat_document(&p).unwrap());
    }

    #[test]
    fn a_stamp_survives_json_ipc_and_allows_a_conditional_save() {
        let d = tmp();
        let p = d.path().join("a.md");
        fs::write(&p, "old").unwrap();
        let stamp = read_document(&p).unwrap().stamp;
        let wire = serde_json::to_value(&stamp).unwrap();
        assert!(wire.is_string());
        let returned: FileStamp = serde_json::from_value(wire).unwrap();
        write_document(&p, "new", WriteCondition::Unchanged { stamp: returned }).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
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
        let s1 = write_document(&p, "one", WriteCondition::Absent).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "one");
        let s2 = write_document(&p, "two", WriteCondition::Unchanged { stamp: s1 }).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(Some(s2), stat_document(&p).unwrap());
        let names: Vec<_> = fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("a.md")]);
    }

    #[test]
    fn refuses_to_clobber_external_changes() {
        let d = tmp();
        let p = d.path().join("a.md");
        let stale = write_document(&p, "mine", WriteCondition::Absent).unwrap();
        fs::write(&p, "theirs, and longer").unwrap();
        assert!(matches!(write_document(&p, "mine v2", WriteCondition::Unchanged { stamp: stale }), Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "theirs, and longer");
    }

    #[test]
    fn confirmed_overwrite_refuses_changes_during_the_write() {
        let d = tmp();
        let p = d.path().join("a.md");
        fs::write(&p, "theirs").unwrap();
        let result = write_document_with(&p, "mine", WriteCondition::Overwrite, || {
            fs::write(&p, "their newer edit").unwrap();
        });
        assert!(matches!(result, Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "their newer edit");
    }

    #[test]
    fn absent_condition_refuses_recreated_file() {
        let d = tmp();
        let p = d.path().join("a.md");
        fs::write(&p, "theirs").unwrap();
        assert!(matches!(write_document(&p, "mine", WriteCondition::Absent), Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "theirs");
    }

    #[test]
    fn absent_condition_preserves_file_created_after_final_check() {
        let d = tmp();
        let p = d.path().join("a.md");
        let result = write_document_with_hooks(&p, "mine", WriteCondition::Absent, || {}, || {
            fs::write(&p, "theirs").unwrap();
        });
        assert!(matches!(result, Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "theirs");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn overwrite_of_initially_absent_file_preserves_late_creation() {
        let d = tmp();
        let p = d.path().join("a.md");
        let result = write_document_with_hooks(&p, "mine", WriteCondition::Overwrite, || {}, || {
            fs::write(&p, "theirs").unwrap();
        });
        assert!(matches!(result, Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "theirs");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn no_replace_install_preserves_existing_destination() {
        let d = tmp();
        let source = d.path().join("prepared.tmp");
        let target = d.path().join("a.md");
        fs::write(&source, "mine").unwrap();
        fs::write(&target, "theirs").unwrap();
        assert!(rename_no_replace(&source, &target).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "theirs");
        assert_eq!(fs::read_to_string(&source).unwrap(), "mine");
    }

    #[cfg(windows)]
    #[test]
    fn creates_new_file_beyond_legacy_windows_path_limit() {
        use std::os::windows::ffi::OsStrExt;
        let d = tmp();
        let mut dir = d.path().to_path_buf();
        for _ in 0..22 { dir.push("nestedfolder"); }
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.md");
        assert!(p.as_os_str().encode_wide().count() > 260);
        write_document(&p, "mine", WriteCondition::Absent).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "mine");
    }

    #[cfg(unix)]
    #[test]
    fn absent_condition_preserves_symlink_created_after_final_check() {
        let d = tmp();
        let p = d.path().join("a.md");
        let other = d.path().join("other.md");
        fs::write(&other, "theirs").unwrap();
        let result = write_document_with_hooks(&p, "mine", WriteCondition::Absent, || {}, || {
            std::os::unix::fs::symlink(&other, &p).unwrap();
        });
        assert!(matches!(result, Err(DocError::Conflict)));
        assert_eq!(fs::read_link(&p).unwrap(), other);
        assert_eq!(fs::read_to_string(&other).unwrap(), "theirs");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 2);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn detects_same_size_change_with_restored_mtime() {
        let d = tmp();
        let p = d.path().join("a.md");
        let stale = write_document(&p, "mine", WriteCondition::Absent).unwrap();
        let modified = fs::metadata(&p).unwrap().modified().unwrap();
        fs::write(&p, "evil").unwrap();
        OpenOptions::new().write(true).open(&p).unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified)).unwrap();
        let observed = stat_document(&p).unwrap().unwrap();
        assert_eq!(fs::metadata(&p).unwrap().modified().unwrap(), modified);
        assert_eq!(fs::metadata(&p).unwrap().len(), 4);
        assert_ne!(stale, observed);
        assert!(matches!(write_document(&p, "edit", WriteCondition::Unchanged { stamp: stale }), Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "evil");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn detects_atomic_replacement_with_copied_timestamp() {
        let d = tmp();
        let p = d.path().join("a.md");
        let replacement = d.path().join("replacement.md");
        let stale = write_document(&p, "mine", WriteCondition::Absent).unwrap();
        let modified = fs::metadata(&p).unwrap().modified().unwrap();
        fs::write(&replacement, "evil").unwrap();
        OpenOptions::new().write(true).open(&replacement).unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified)).unwrap();
        fs::rename(&replacement, &p).unwrap();
        assert_eq!(fs::metadata(&p).unwrap().modified().unwrap(), modified);
        assert_ne!(stat_document(&p).unwrap(), Some(stale.clone()));
        assert!(matches!(write_document(&p, "edit", WriteCondition::Unchanged { stamp: stale }), Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&p).unwrap(), "evil");
    }

    #[test]
    fn expected_stamp_on_a_deleted_file_is_a_conflict() {
        let d = tmp();
        let p = d.path().join("a.md");
        let s = write_document(&p, "x", WriteCondition::Absent).unwrap();
        fs::remove_file(&p).unwrap();
        assert!(matches!(write_document(&p, "y", WriteCondition::Unchanged { stamp: s }), Err(DocError::Conflict)));
        assert!(!p.exists());
    }

    #[test]
    fn missing_parent_directory_is_not_found() {
        let d = tmp();
        let p = d.path().join("no/such/dir/a.md");
        assert!(matches!(write_document(&p, "x", WriteCondition::Absent), Err(DocError::NotFound)));
    }

    #[test]
    fn writing_to_a_directory_fails() {
        let d = tmp();
        assert!(matches!(write_document(d.path(), "x", WriteCondition::Overwrite), Err(DocError::IsDirectory)));
    }

    #[cfg(unix)]
    #[test]
    fn keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let p = d.path().join("a.md");
        fs::write(&p, "x").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
        write_document(&p, "y", WriteCondition::Overwrite).unwrap();
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
        write_document(&link, "new", WriteCondition::Unchanged { stamp: s }).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_write_an_old_target_after_a_symlink_is_retargeted() {
        let d = tmp();
        let old = d.path().join("old.md");
        let new = d.path().join("new.md");
        let link = d.path().join("link.md");
        fs::write(&old, "old content").unwrap();
        fs::write(&new, "new content").unwrap();
        std::os::unix::fs::symlink(&old, &link).unwrap();
        let stamp = read_document(&link).unwrap().stamp;
        let result = write_document_with(&link, "my edit", WriteCondition::Unchanged { stamp }, || {
            fs::remove_file(&link).unwrap();
            std::os::unix::fs::symlink(&new, &link).unwrap();
        });
        assert!(matches!(result, Err(DocError::Conflict)));
        assert_eq!(fs::read_to_string(&old).unwrap(), "old content");
        assert_eq!(fs::read_to_string(&new).unwrap(), "new content");
        assert_eq!(fs::canonicalize(&link).unwrap(), new);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_replace_a_dangling_symlink_on_save() {
        let d = tmp();
        let target = d.path().join("missing.md");
        let link = d.path().join("link.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(matches!(write_document(&link, "mine", WriteCondition::Absent), Err(DocError::NotFound)));
        assert_eq!(fs::read_link(&link).unwrap(), target);
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_dangling_symlink_that_appears_during_a_new_file_save() {
        let d = tmp();
        let target = d.path().join("missing.md");
        let link = d.path().join("link.md");
        let result = write_document_with(&link, "mine", WriteCondition::Absent, || {
            std::os::unix::fs::symlink(&target, &link).unwrap();
        });
        assert!(matches!(result, Err(DocError::Conflict)));
        assert_eq!(fs::read_link(&link).unwrap(), target);
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_non_atomic_write_in_read_only_directories() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let dir = d.path().join("ro");
        fs::create_dir(&dir).unwrap();
        let p = dir.join("a.md");
        fs::write(&p, "old").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let result = write_document(&p, "new", WriteCondition::Overwrite);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        // Root can still create a temp file. Otherwise the write must fail without
        // truncating the existing file.
        if result.is_err() {
            assert_eq!(fs::read_to_string(&p).unwrap(), "old");
        }
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
        let result = write_document(&p, "clobber", WriteCondition::Overwrite);
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
            let stamp = write_document(&p, &text, WriteCondition::Absent).unwrap();
            let doc = read_document(&p).unwrap();
            prop_assert_eq!(doc.text, text);
            prop_assert_eq!(doc.stamp, stamp);
        }
    }
}
