//! Launch arguments and the startup document. The file is read on a worker thread
//! while Tauri builds the window and WebKit boots, so it's ready when the page asks.

use crate::document_io::{self, DocError, ReadDocument};
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartupDocument {
    None,
    File { file: ReadDocument },
    /// The path doesn't exist yet: start empty and save there.
    New { path: String },
    Error { path: String, code: &'static str, message: String },
}

/// First positional argument. Flags are ignored (Chromium-style flags from launchers,
/// `--help` etc.); `--` ends flag parsing so files starting with '-' can be opened.
pub fn parse_args<I: IntoIterator<Item = OsString>>(args: I) -> Option<PathBuf> {
    let mut rest = args.into_iter().skip(1);
    while let Some(arg) = rest.next() {
        if arg == "--" {
            return rest.next().map(PathBuf::from);
        }
        if arg.to_string_lossy().starts_with('-') {
            continue;
        }
        return Some(PathBuf::from(arg));
    }
    None
}

pub fn load(path: Option<&Path>) -> StartupDocument {
    let Some(path) = path else { return StartupDocument::None };
    match document_io::read_document(path) {
        Ok(file) => StartupDocument::File { file },
        Err(DocError::NotFound) => StartupDocument::New {
            path: document_io::absolute(path).unwrap_or_else(|_| path.to_path_buf()).to_string_lossy().into_owned(),
        },
        Err(e) => StartupDocument::Error {
            path: path.to_string_lossy().into_owned(),
            code: e.code(),
            message: e.to_string(),
        },
    }
}

/// Holds the in-flight prefetch; the result is cached so a page reload gets it again.
pub struct Startup {
    pub path: Option<PathBuf>,
    pending: Mutex<Option<JoinHandle<StartupDocument>>>,
    result: OnceLock<StartupDocument>,
}

impl Startup {
    pub fn prefetch(path: Option<PathBuf>) -> Self {
        let for_thread = path.clone();
        let handle = std::thread::Builder::new()
            .name("startup-read".into())
            .spawn(move || load(for_thread.as_deref()))
            .ok();
        Startup { path, pending: Mutex::new(handle), result: OnceLock::new() }
    }

    /// Blocks until the prefetch finishes (it usually already has).
    pub fn document(&self) -> StartupDocument {
        self.result
            .get_or_init(|| {
                let handle = self.pending.lock().ok().and_then(|mut h| h.take());
                handle
                    .and_then(|h| h.join().ok())
                    // Thread spawn failed or panicked: read synchronously instead.
                    .unwrap_or_else(|| load(self.path.as_deref()))
            })
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn parses_the_first_positional_argument() {
        assert_eq!(parse_args(args(&["scrivo"])), None);
        assert_eq!(parse_args(args(&["scrivo", "a.md"])), Some("a.md".into()));
        assert_eq!(parse_args(args(&["scrivo", "--flag", "a.md", "b.md"])), Some("a.md".into()));
        assert_eq!(parse_args(args(&["scrivo", "--", "-weird.md"])), Some("-weird.md".into()));
        assert_eq!(parse_args(args(&["scrivo", "--"])), None);
    }

    #[test]
    fn loads_existing_new_and_broken_paths() {
        let d = tempfile::tempdir().unwrap();
        let existing = d.path().join("a.md");
        std::fs::write(&existing, "# A").unwrap();
        assert!(matches!(load(Some(&existing)), StartupDocument::File { file } if file.text == "# A"));

        let missing = d.path().join("new.md");
        assert!(matches!(load(Some(&missing)), StartupDocument::New { path } if path.ends_with("new.md")));

        assert!(matches!(load(Some(d.path())), StartupDocument::Error { code: "is-directory", .. }));
        assert!(matches!(load(None), StartupDocument::None));
    }

    #[test]
    fn prefetch_result_is_stable_across_calls() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        std::fs::write(&p, "x").unwrap();
        let startup = Startup::prefetch(Some(p.clone()));
        let first = startup.document();
        std::fs::write(&p, "changed").unwrap();
        let second = startup.document();
        assert!(matches!((first, second), (StartupDocument::File { file: a }, StartupDocument::File { file: b }) if a.text == "x" && b.text == "x"));
    }

    #[test]
    fn serializes_with_a_kind_tag() {
        let json = serde_json::to_value(StartupDocument::New { path: "/x.md".into() }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "new", "path": "/x.md" }));
    }
}
