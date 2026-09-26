//! `scrivo-render [--base-dir DIR] [--asset-prefix PREFIX] < doc.md > rendered.json`
//!
//! The renderer as a command, for the browser dev server and its E2E tests, so they
//! exercise exactly the code the app ships. A local image becomes
//! `PREFIX + encodeURIComponent(absolute path)`.

use scrivo_render::{Options, render, url::encode_uri_component};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn main() {
    let mut base_dir: Option<PathBuf> = None;
    let mut asset_prefix = String::from("asset://localhost/");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--base-dir" => base_dir = args.next().map(PathBuf::from),
            "--asset-prefix" => asset_prefix = args.next().unwrap_or_default(),
            other => {
                eprintln!("scrivo-render: unknown argument {other:?}");
                std::process::exit(2);
            }
        }
    }
    let mut markdown = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut markdown) {
        eprintln!("scrivo-render: stdin is not UTF-8 text: {e}");
        std::process::exit(1);
    }
    let asset_url = |path: &Path| format!("{asset_prefix}{}", encode_uri_component(&path.to_string_lossy()));
    let rendered = render(&markdown, &Options { base_dir: base_dir.as_deref(), asset_url: &asset_url });
    let json = serde_json::to_vec(&rendered).expect("rendered output serializes");
    std::io::stdout().write_all(&json).expect("write stdout");
}
