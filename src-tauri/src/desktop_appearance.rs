//! Optional desktop theme catalog, injected before frontend appearance is applied.
use serde::{Deserialize, Serialize};
use std::{fs::File, io::Read, path::Path};

const MAX_CATALOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CSS_BYTES: usize = 1024 * 1024;

#[derive(Deserialize, Serialize)]
pub struct DesktopAppearance {
    themes: Vec<Theme>,
    theme: String,
    mode: Mode,
}

#[derive(Deserialize, Serialize)]
struct Theme {
    id: String,
    name: String,
    css: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Light,
    Dark,
}

fn parse(bytes: &[u8]) -> Option<DesktopAppearance> {
    if bytes.len() as u64 > MAX_CATALOG_BYTES {
        return None;
    }
    let appearance: DesktopAppearance = serde_json::from_slice(bytes).ok()?;
    if appearance.themes.is_empty() || appearance.themes.len() > 64 {
        return None;
    }
    let mut ids = std::collections::HashSet::new();
    for theme in &appearance.themes {
        let slug = theme.id.strip_prefix("builtin:desktop:")?;
        if slug.is_empty() || theme.id.len() > 100
            || !slug.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || theme.name.is_empty() || theme.name.len() > 100
            || theme.css.trim().is_empty() || theme.css.len() > MAX_CSS_BYTES
            || !ids.insert(&theme.id)
        {
            return None;
        }
    }
    ids.contains(&appearance.theme).then_some(appearance)
}

/// Missing, corrupt and oversized files leave the app's own preferences intact.
/// Read through a bounded stream even if the file changes after it is opened.
pub fn load(config_dir: &Path) -> Option<DesktopAppearance> {
    let file = File::open(config_dir.join("desktop-theme.json")).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_CATALOG_BYTES + 1).read_to_end(&mut bytes).ok()?;
    parse(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> serde_json::Value {
        json!({"theme": "builtin:desktop:nord", "mode": "dark", "themes": [
            {"id": "builtin:desktop:nord", "name": "Nord", "css": ":root { --text-normal: #eceff4; }"}
        ]})
    }

    #[test]
    fn loads_the_selected_palette_and_mode_from_disk() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("desktop-theme.json"), catalog().to_string()).unwrap();
        let appearance = load(directory.path()).unwrap();
        assert_eq!(appearance.theme, "builtin:desktop:nord");
        assert!(matches!(appearance.mode, Mode::Dark));
        assert!(appearance.themes[0].css.contains("#eceff4"));
    }

    #[test]
    fn rejects_invalid_selection_catalog_and_mode() {
        assert!(parse(b"null").is_none());
        assert!(parse(b"{").is_none());
        for (field, value) in [("theme", json!("missing")), ("mode", json!("system")), ("themes", json!([]))] {
            let mut input = catalog(); input[field] = value;
            assert!(parse(input.to_string().as_bytes()).is_none());
        }
        for (field, value) in [("id", json!("builtin:desktop:../nord")), ("css", json!(" ")), ("css", json!("x".repeat(MAX_CSS_BYTES + 1)))] {
            let mut input = catalog(); input["themes"][0][field] = value;
            assert!(parse(input.to_string().as_bytes()).is_none());
        }
        let mut input = catalog();
        input["themes"] = json!([input["themes"][0], input["themes"][0]]);
        assert!(parse(input.to_string().as_bytes()).is_none());
        assert!(parse(&vec![b' '; MAX_CATALOG_BYTES as usize + 1]).is_none());
    }

    #[test]
    fn absent_catalog_is_optional() {
        let directory = tempfile::tempdir().unwrap();
        assert!(load(directory.path()).is_none());
    }
}
