//! Startup timing marks (`SCRIVO_TRACE=1`), relative to process start.

use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();
static ENABLED: OnceLock<bool> = OnceLock::new();

pub fn init() {
    START.get_or_init(Instant::now);
    ENABLED.get_or_init(|| std::env::var_os("SCRIVO_TRACE").is_some_and(|v| v == "1"));
}

pub fn enabled() -> bool {
    *ENABLED.get().unwrap_or(&false)
}

pub fn mark(label: &str) {
    if let (true, Some(start)) = (enabled(), START.get()) {
        println!("SCRIVO_TRACE {:8.1} ms  {label}", start.elapsed().as_secs_f64() * 1000.0);
    }
}
