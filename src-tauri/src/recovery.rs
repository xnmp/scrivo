//! Private, atomic recovery copies outside the document directory.
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::collections::HashSet;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SEVEN_DAYS_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryFormat {
    pub eol: String,
    pub bom: bool,
    pub mixed_eol: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCopy {
    pub id: String,
    pub path: Option<String>,
    pub stamp: Option<String>,
    pub format: RecoveryFormat,
    pub text: String,
    pub updated_at: u64,
}

fn invalid_id() -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, "invalid recovery id") }

fn path_for(root: &Path, id: &str) -> io::Result<PathBuf> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(invalid_id());
    }
    Ok(root.join(format!("{id}.json")))
}

fn ensure_private_dir(root: &Path) -> io::Result<()> {
    fs::create_dir_all(root)?;
    if fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "recovery directory is a symlink"));
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn sync_dir(root: &Path) {
    #[cfg(unix)] { let _ = File::open(root).and_then(|dir| dir.sync_all()); }
    #[cfg(not(unix))] { let _ = root; }
}

pub fn put(root: &Path, copy: &RecoveryCopy) -> io::Result<()> {
    let target = path_for(root, &copy.id)?;
    if !matches!(copy.format.eol.as_str(), "\n" | "\r" | "\r\n") {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid line ending"));
    }
    ensure_private_dir(root)?;
    let mut temp = tempfile::NamedTempFile::new_in(root)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file().set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    serde_json::to_writer(&mut temp, copy)?;
    temp.flush()?;
    temp.as_file().sync_all()?;
    temp.persist(target).map_err(|error| error.error)?;
    sync_dir(root);
    prune(root)?;
    Ok(())
}

pub fn remove(root: &Path, id: &str) -> io::Result<()> {
    let target = path_for(root, id)?;
    match fs::remove_file(target) {
        Ok(()) => sync_dir(root),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn entries(root: &Path) -> io::Result<Vec<(RecoveryCopy, PathBuf, u64)>> {
    let mut result = Vec::new();
    let reader = match fs::read_dir(root) {
        Ok(reader) => reader,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(error),
    };
    for entry in reader {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json") || !entry.file_type()?.is_file() { continue; }
        let file = File::open(&path)?;
        let Ok(copy) = serde_json::from_reader::<_, RecoveryCopy>(file) else { continue; };
        if path_for(root, &copy.id).ok().as_deref() != Some(path.as_path()) { continue; }
        result.push((copy, path, entry.metadata()?.len()));
    }
    result.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at));
    Ok(result)
}

fn prune_with_limit(root: &Path, max_bytes: u64) -> io::Result<Vec<RecoveryCopy>> {
    let mut kept = Vec::new();
    let mut identities = HashSet::new();
    let mut bytes: u64 = 0;
    let now = now_ms();
    for (copy, path, size) in entries(root)? {
        let identity = copy.path.clone().unwrap_or_else(|| format!("untitled:{}", copy.id));
        let required = identities.insert(identity);
        let expired = now.saturating_sub(copy.updated_at) > SEVEN_DAYS_MS;
        // The size and age caps apply only to redundant history. The latest copy
        // for each document stays until its owner saves or explicitly discards it.
        if !required && (expired || bytes.saturating_add(size) > max_bytes) {
            fs::remove_file(path)?;
        } else {
            bytes += size;
            kept.push(copy);
        }
    }
    Ok(kept)
}

fn prune(root: &Path) -> io::Result<Vec<RecoveryCopy>> { prune_with_limit(root, MAX_TOTAL_BYTES) }

pub fn list(root: &Path) -> io::Result<Vec<RecoveryCopy>> { prune(root) }

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(id: &str, text: &str) -> RecoveryCopy {
        RecoveryCopy { id: id.into(), path: None, stamp: None,
            format: RecoveryFormat { eol: "\r\n".into(), bom: true, mixed_eol: false },
            text: text.into(), updated_at: now_ms() }
    }

    #[test]
    fn round_trip_keeps_exact_text_and_private_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("recovery");
        let original = copy("abc-123", "# hi\n😀\n");
        put(&root, &original).unwrap();
        let found = list(&root).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].text, original.text);
        assert_eq!(found[0].format.eol, "\r\n");
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&root).unwrap().permissions().mode() & 0o777, 0o700);
            assert_eq!(fs::metadata(root.join("abc-123.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        remove(&root, "abc-123").unwrap();
        assert!(list(&root).unwrap().is_empty());
    }

    #[test]
    fn rejects_path_traversal_and_prunes_expired_redundant_copies() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("recovery");
        assert!(put(&root, &copy("../escape", "x")).is_err());
        let mut expired = copy("old", "old");
        expired.updated_at -= SEVEN_DAYS_MS + 1;
        put(&root, &expired).unwrap();
        assert_eq!(list(&root).unwrap().len(), 1);
        let current = copy("new", "new");
        let mut older = expired.clone();
        older.path = Some("/notes.md".into());
        put(&root, &older).unwrap();
        let mut newer = current;
        newer.path = Some("/notes.md".into());
        put(&root, &newer).unwrap();
        assert_eq!(list(&root).unwrap().iter().filter(|c| c.path.as_deref() == Some("/notes.md")).count(), 1);
    }

    #[test]
    fn size_cap_never_deletes_the_only_copy_of_another_dirty_document() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("recovery");
        put(&root, &copy("first", &"a".repeat(100))).unwrap();
        put(&root, &copy("second", &"b".repeat(100))).unwrap();
        assert_eq!(prune_with_limit(&root, 1).unwrap().len(), 2);
    }
}
