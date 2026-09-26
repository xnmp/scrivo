//! URL policy: which link and image destinations may reach the page, and how local
//! image paths are resolved. Pure string and path logic, no filesystem access.

use std::path::{Component, Path, PathBuf};

/// Schemes a link may use. Anything else (javascript:, vbscript:, data:, the app's own
/// ipc:/asset: schemes, ...) is dropped.
const LINK_SCHEMES: &[&str] = &["http", "https", "mailto", "tel", "file"];

/// Image formats allowed as `data:` URLs. `<img>` never runs scripts, SVG included.
const DATA_IMAGE_TYPES: &[&str] = &["png", "gif", "jpeg", "jpg", "webp", "avif", "bmp", "svg+xml"];

/// What the browser will see: leading/trailing C0 controls and spaces stripped, ASCII
/// tabs and newlines removed anywhere (WHATWG URL parsing does the same, which is how
/// `java\tscript:` sneaks past naive filters).
pub fn clean(url: &str) -> String {
    url.trim_matches(|c: char| c <= ' ').chars().filter(|&c| !matches!(c, '\t' | '\n' | '\r')).collect()
}

/// The URL scheme, lowercased, if the URL has one. A single letter followed by ':' is a
/// Windows drive (`C:\x.png`), not a scheme.
pub fn scheme(url: &str) -> Option<String> {
    let end = url.find(':')?;
    let candidate = &url[..end];
    let valid = candidate.len() > 1
        && candidate.starts_with(|c: char| c.is_ascii_alphabetic())
        && candidate.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then(|| candidate.to_ascii_lowercase())
}

/// A link destination that is safe to put in `href`, or None to render the link inert.
pub fn safe_link(raw: &str) -> Option<String> {
    let url = clean(raw);
    match scheme(&url) {
        None => Some(url),
        Some(s) if LINK_SCHEMES.contains(&s.as_str()) => Some(url),
        Some(_) => None,
    }
}

/// Where an image comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageSource {
    /// Loaded as-is (http(s) or an allowed data: URL).
    Remote(String),
    /// A local file, by absolute path.
    Local(PathBuf),
    /// Can't be shown: relative path without a document directory, or a disallowed URL.
    Unavailable,
}

pub fn image_source(raw: &str, base_dir: Option<&Path>) -> ImageSource {
    let url = clean(raw);
    if url.is_empty() {
        return ImageSource::Unavailable;
    }
    match scheme(&url).as_deref() {
        Some("http" | "https") => ImageSource::Remote(url),
        Some("data") => {
            let mime = url["data:".len()..].split([';', ',']).next().unwrap_or("").to_ascii_lowercase();
            match mime.strip_prefix("image/") {
                Some(kind) if DATA_IMAGE_TYPES.contains(&kind) => ImageSource::Remote(url),
                _ => ImageSource::Unavailable,
            }
        }
        Some("file") => file_url_path(&url).map_or(ImageSource::Unavailable, ImageSource::Local),
        Some(_) => ImageSource::Unavailable,
        None if url.starts_with("//") && !url.starts_with("///") && !is_windows_unc(&url) => {
            // Protocol-relative (//cdn.example.com/x.png): there's no page protocol to
            // inherit, so assume https.
            ImageSource::Remote(format!("https:{url}"))
        }
        None => {
            let path = PathBuf::from(percent_decode(url.split(['?', '#']).next().unwrap_or("")));
            if is_absolute(&path) {
                ImageSource::Local(normalize(&path))
            } else if let Some(dir) = base_dir {
                ImageSource::Local(normalize(&dir.join(path)))
            } else {
                ImageSource::Unavailable
            }
        }
    }
}

fn is_windows_unc(url: &str) -> bool {
    url.starts_with("\\\\")
}

/// Absolute on any platform the document might have been written on: `/x`, `C:\x`,
/// `C:/x`, `\\server\share`.
fn is_absolute(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let b = s.as_bytes();
    path.is_absolute()
        || s.starts_with('/')
        || s.starts_with("\\\\")
        || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'/' | b'\\'))
}

/// `file:///home/a.png` → `/home/a.png`; `file:///C:/a.png` → `C:/a.png`.
fn file_url_path(url: &str) -> Option<PathBuf> {
    let rest = &url["file:".len()..];
    let rest = rest.strip_prefix("//").map(|r| r.strip_prefix("localhost").unwrap_or(r)).unwrap_or(rest);
    let decoded = percent_decode(rest.split(['?', '#']).next()?);
    let b = decoded.as_bytes();
    let path = if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        decoded[1..].to_owned()
    } else {
        decoded
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// Resolve `.` and `..` lexically. The file may not exist, and symlinks are the
/// filesystem's business, not the renderer's.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !matches!(out.components().next_back(), None | Some(Component::RootDir | Component::Prefix(_))) {
                    out.pop();
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// `%20` → space. Malformed escapes and escapes that don't form UTF-8 stay as written.
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2]))
        {
            out.push(h * 16 + l);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_owned())
}

fn hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// `encodeURIComponent`: what Tauri's `convertFileSrc` applies to a path.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_script_schemes_however_they_are_disguised() {
        for url in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "  javascript:alert(1)",
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "\u{1}javascript:alert(1)",
            "vbscript:msgbox(1)",
            "data:text/html,<script>alert(1)</script>",
            "ipc://localhost/read_document",
            "asset://localhost/%2Fetc%2Fpasswd",
            "tauri://localhost/index.html",
        ] {
            assert_eq!(safe_link(url), None, "{url:?} must be blocked");
        }
    }

    #[test]
    fn keeps_ordinary_links() {
        for url in ["https://example.com/a?b=c#d", "http://x", "mailto:me@example.com", "tel:+123", "file:///tmp/a.md"] {
            assert_eq!(safe_link(url).as_deref(), Some(url));
        }
        for url in ["other.md", "../up/other.md#part", "#section", "/abs/path.md", "C:\\docs\\a.md", "C:/docs/a.md", "a:b/c.md"] {
            // "a:b" is a single-letter "scheme": a drive, i.e. a path.
            assert!(safe_link(url).is_some(), "{url:?}");
        }
    }

    #[test]
    fn resolves_image_paths_against_the_document() {
        let dir = Some(Path::new("/docs/notes"));
        assert_eq!(image_source("img/a.png", dir), ImageSource::Local("/docs/notes/img/a.png".into()));
        assert_eq!(image_source("./a.png", dir), ImageSource::Local("/docs/notes/a.png".into()));
        assert_eq!(image_source("../shared/a.png", dir), ImageSource::Local("/docs/shared/a.png".into()));
        assert_eq!(image_source("../../../../a.png", dir), ImageSource::Local("/a.png".into()));
        assert_eq!(image_source("my%20pic.png", dir), ImageSource::Local("/docs/notes/my pic.png".into()));
        assert_eq!(image_source("a.png?v=2#x", dir), ImageSource::Local("/docs/notes/a.png".into()));
        assert_eq!(image_source("/abs/a.png", None), ImageSource::Local("/abs/a.png".into()));
        assert_eq!(image_source("file:///abs/a%20b.png", None), ImageSource::Local("/abs/a b.png".into()));
        assert_eq!(image_source("file:///C:/pics/a.png", None), ImageSource::Local("C:/pics/a.png".into()));
        assert_eq!(image_source("a.png", None), ImageSource::Unavailable);
    }

    #[test]
    fn allows_web_and_image_data_urls_only() {
        assert_eq!(image_source("https://x/a.png", None), ImageSource::Remote("https://x/a.png".into()));
        assert_eq!(image_source("//cdn.x/a.png", None), ImageSource::Remote("https://cdn.x/a.png".into()));
        assert_eq!(image_source("data:image/png;base64,AAAA", None), ImageSource::Remote("data:image/png;base64,AAAA".into()));
        assert_eq!(image_source("data:image/svg+xml,<svg/>", None), ImageSource::Remote("data:image/svg+xml,<svg/>".into()));
        assert_eq!(image_source("data:text/html,<b>", None), ImageSource::Unavailable);
        assert_eq!(image_source("javascript:alert(1)", None), ImageSource::Unavailable);
        assert_eq!(image_source("asset://localhost/x", None), ImageSource::Unavailable);
        assert_eq!(image_source("", Some(Path::new("/d"))), ImageSource::Unavailable);
        assert_eq!(image_source("   ", Some(Path::new("/d"))), ImageSource::Unavailable);
    }

    #[test]
    fn percent_decoding_is_lenient() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("%E2%82%AC"), "€");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz%2"), "%zz%2");
        assert_eq!(percent_decode("%FF"), "%FF"); // not UTF-8: keep as written
    }

    #[test]
    fn encodes_like_encode_uri_component() {
        assert_eq!(encode_uri_component("/home/me/a b(1).png"), "%2Fhome%2Fme%2Fa%20b(1).png");
        assert_eq!(encode_uri_component("C:\\x\\é.png"), "C%3A%5Cx%5C%C3%A9.png");
    }
}
