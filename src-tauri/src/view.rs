//! The reading view: documents rendered by `scrivo_render`, plus the platform glue the
//! pure renderer leaves to its caller (asset URLs, which files the page may load).

use crate::document_io::{FileStamp, ReadDocument};
use scrivo_render::{Heading, Options, Rendered, render, url::encode_uri_component};
use serde::Serialize;
use std::path::Path;

/// A rendered document as the page receives it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDocument {
    /// None when rendering an unsaved buffer.
    pub path: Option<String>,
    pub stamp: Option<FileStamp>,
    pub html: String,
    pub headings: Vec<Heading>,
    /// Granted to the asset protocol before the page sees the HTML; not sent.
    #[serde(skip)]
    pub local_images: Vec<String>,
}

/// The URL Tauri's `convertFileSrc(path)` produces for the page.
pub fn asset_url(path: &Path) -> String {
    let encoded = encode_uri_component(&path.to_string_lossy());
    if cfg!(any(windows, target_os = "android")) {
        format!("http://asset.localhost/{encoded}")
    } else {
        format!("asset://localhost/{encoded}")
    }
}

/// Render markdown that belongs to `path` (None: unsaved, relative images can't load).
pub fn render_text(text: &str, path: Option<&str>) -> ViewDocument {
    // A byte-order mark is encoding, not content; left in, it would stop a first-line
    // heading from being one.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let base_dir = path.map(Path::new).and_then(Path::parent);
    let Rendered { html, headings, local_images } = render(text, &Options { base_dir, asset_url: &asset_url });
    ViewDocument { path: path.map(str::to_owned), stamp: None, html, headings, local_images }
}

pub fn render_document(doc: &ReadDocument) -> ViewDocument {
    ViewDocument { stamp: Some(doc.stamp), ..render_text(&doc.text, Some(&doc.path)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_urls_match_convert_file_src() {
        let url = asset_url(Path::new("/home/me/a b.png"));
        if cfg!(windows) {
            assert_eq!(url, "http://asset.localhost/%2Fhome%2Fme%2Fa%20b.png");
        } else {
            assert_eq!(url, "asset://localhost/%2Fhome%2Fme%2Fa%20b.png");
        }
    }

    #[test]
    fn a_byte_order_mark_does_not_break_the_first_heading() {
        let view = render_text("\u{feff}# Title\n", Some("/d/a.md"));
        assert_eq!(view.headings.len(), 1);
        assert_eq!(view.headings[0].text, "Title");
    }

    #[test]
    fn images_resolve_next_to_the_document() {
        let view = render_text("![x](img/p.png)", Some("/docs/a.md"));
        assert_eq!(view.local_images, vec![Path::new("/docs").join("img/p.png").to_string_lossy().into_owned()]);
        let unsaved = render_text("![x](img/p.png)", None);
        assert!(unsaved.local_images.is_empty());
        assert!(unsaved.html.contains("image-missing"));
    }
}
