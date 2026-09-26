//! Launch arguments and the startup document. The file is read (and rendered for the
//! reading view) on a worker thread while Tauri builds the window and WebKit boots, so
//! it's ready when the page asks.

use crate::document_io::{self, DocError, ReadDocument};
use crate::view::{self, ViewDocument};
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchArgs {
    pub path: Option<PathBuf>,
    /// `--edit` / `-e`: open in the editor instead of the reading view.
    pub edit: bool,
}

/// The first positional argument is the document. Unknown flags are ignored (launchers
/// pass Chromium-style flags); `--` ends flag parsing so files starting with '-' open.
pub fn parse_args<I: IntoIterator<Item = OsString>>(args: I) -> LaunchArgs {
    let mut parsed = LaunchArgs::default();
    let mut rest = args.into_iter().skip(1);
    while let Some(arg) = rest.next() {
        if arg == "--" {
            if parsed.path.is_none() {
                parsed.path = rest.next().map(PathBuf::from);
            }
            break;
        }
        if arg == "--edit" || arg == "-e" {
            parsed.edit = true;
        } else if arg.to_string_lossy().starts_with('-') {
            continue;
        } else if parsed.path.is_none() {
            parsed.path = Some(PathBuf::from(arg));
        }
    }
    parsed
}

/// What the page shows first.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartupView {
    /// An existing document, rendered for the reading view.
    View { document: ViewDocument },
    /// Start in the editor: no document, a new file, an unreadable one, or `--edit`.
    Edit,
}

struct Prefetched {
    document: StartupDocument,
    view: StartupView,
}

fn prefetch(args: &LaunchArgs) -> Prefetched {
    let document = load(args.path.as_deref());
    let view = match &document {
        StartupDocument::File { file } if !args.edit => StartupView::View { document: view::render_document(file) },
        _ => StartupView::Edit,
    };
    Prefetched { document, view }
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
    pub args: LaunchArgs,
    pending: Mutex<Option<JoinHandle<Prefetched>>>,
    result: OnceLock<Prefetched>,
}

impl Startup {
    pub fn prefetch(args: LaunchArgs) -> Self {
        let for_thread = args.clone();
        let handle = std::thread::Builder::new()
            .name("startup-read".into())
            .spawn(move || prefetch(&for_thread))
            .ok();
        Startup { args, pending: Mutex::new(handle), result: OnceLock::new() }
    }

    /// Blocks until the prefetch finishes (it usually already has).
    fn get(&self) -> &Prefetched {
        self.result.get_or_init(|| {
            let handle = self.pending.lock().ok().and_then(|mut h| h.take());
            handle
                .and_then(|h| h.join().ok())
                // Thread spawn failed or panicked: do the work here instead.
                .unwrap_or_else(|| prefetch(&self.args))
        })
    }

    pub fn document(&self) -> StartupDocument {
        self.get().document.clone()
    }

    pub fn view(&self) -> StartupView {
        self.get().view.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    fn path(p: &str) -> Option<PathBuf> {
        Some(PathBuf::from(p))
    }

    #[test]
    fn parses_the_first_positional_argument() {
        assert_eq!(parse_args(args(&["scrivo"])), LaunchArgs::default());
        assert_eq!(parse_args(args(&["scrivo", "a.md"])).path, path("a.md"));
        assert_eq!(parse_args(args(&["scrivo", "--flag", "a.md", "b.md"])).path, path("a.md"));
        assert_eq!(parse_args(args(&["scrivo", "--", "-weird.md"])).path, path("-weird.md"));
        assert_eq!(parse_args(args(&["scrivo", "--"])).path, None);
    }

    #[test]
    fn parses_the_edit_flag_anywhere() {
        assert_eq!(parse_args(args(&["scrivo", "--edit", "a.md"])), LaunchArgs { path: path("a.md"), edit: true });
        assert_eq!(parse_args(args(&["scrivo", "a.md", "-e"])), LaunchArgs { path: path("a.md"), edit: true });
        assert_eq!(parse_args(args(&["scrivo", "--", "--edit"])), LaunchArgs { path: path("--edit"), edit: false });
    }

    #[test]
    fn existing_files_open_in_the_reading_view_unless_editing_was_asked_for() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        std::fs::write(&p, "# Hello").unwrap();
        let view = Startup::prefetch(LaunchArgs { path: Some(p.clone()), edit: false }).view();
        assert!(matches!(&view, StartupView::View { document } if document.html.contains("Hello") && document.stamp.is_some()));
        let edit = Startup::prefetch(LaunchArgs { path: Some(p), edit: true }).view();
        assert!(matches!(edit, StartupView::Edit));
        assert!(matches!(Startup::prefetch(LaunchArgs::default()).view(), StartupView::Edit));
        let missing = Startup::prefetch(LaunchArgs { path: Some(d.path().join("new.md")), edit: false });
        assert!(matches!(missing.view(), StartupView::Edit));
        assert!(matches!(missing.document(), StartupDocument::New { .. }));
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
        let startup = Startup::prefetch(LaunchArgs { path: Some(p.clone()), edit: false });
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
