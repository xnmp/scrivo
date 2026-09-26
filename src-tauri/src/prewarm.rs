//! Library start-up that GTK and WebKit otherwise do on the main thread while the window
//! is built, started on worker threads at launch so it overlaps with GTK's own
//! initialisation. Linux only: that's where these costs were measured.
//!
//! Every warm-up is best-effort and changes no behaviour. A missing library or a failed
//! call is ignored, and the main thread then does the same work later, exactly as it
//! would without this module. See docs/ARCHITECTURE.md ("Startup path") for numbers.

use crate::trace;
use std::ffi::{c_char, c_void};

/// Starts the warm-ups and returns immediately.
pub fn start() {
    spawn("egl-warm", egl_client);
    spawn("image-warm", image_loader);
}

fn spawn(name: &'static str, work: fn() -> bool) {
    let _ = std::thread::Builder::new().name(name.into()).spawn(move || {
        let done = work();
        trace::mark(&format!("{name}: {}", if done { "done" } else { "skipped" }));
    });
}

/// libglvnd loads the GPU vendor's EGL implementation once per process, behind a
/// `pthread_once`, on the first EGL call. WebKit makes that call on the main thread when
/// it creates its GL context: 15–20 ms with NVIDIA's driver. Querying the client
/// extensions needs no display or context, so it is safe on any thread.
///
/// Loaded with dlopen rather than linked, so machines without libEGL still start.
fn egl_client() -> bool {
    const EGL_EXTENSIONS: i32 = 0x3055;
    // SAFETY: dlopen/dlsym with valid NUL-terminated names. The handle is never closed:
    // WebKit is about to use the library.
    let symbol = unsafe {
        let lib = libc::dlopen(c"libEGL.so.1".as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        if lib.is_null() {
            return false;
        }
        libc::dlsym(lib, c"eglQueryString".as_ptr())
    };
    if symbol.is_null() {
        return false;
    }
    // SAFETY: the EGL 1.5 prototype is `const char *eglQueryString(EGLDisplay, EGLint)`,
    // where EGLDisplay is `void *` and EGLint is `int32_t`. EGL_NO_DISPLAY is null, which
    // asks for the client extensions (EGL_EXT_client_extensions); an implementation
    // without them returns null and sets an error on this thread only.
    let query: unsafe extern "C" fn(*mut c_void, i32) -> *const c_char = unsafe { std::mem::transmute(symbol) };
    !unsafe { query(std::ptr::null_mut(), EGL_EXTENSIONS) }.is_null()
}

/// GTK draws client-side window decorations whose button icons are SVGs, decoded by
/// gdk-pixbuf. From gdk-pixbuf 2.44 that goes through glycin, which spawns a sandboxed
/// loader process on first use (~20 ms) and reuses it after. Decoding a trivial SVG here
/// starts that loader before GTK asks for its icons; with an older gdk-pixbuf it loads
/// the SVG module instead, which GTK would also do.
fn image_loader() -> bool {
    const SVG: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#;
    let stream = gio::MemoryInputStream::from_bytes(&gio::glib::Bytes::from_static(SVG));
    gdk_pixbuf::Pixbuf::from_stream(&stream, gio::Cancellable::NONE).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The warm-ups run while GTK and WebKit use the same libraries on other threads:
    /// running them concurrently and repeatedly must be safe, and give the same answer.
    #[test]
    fn warm_ups_are_safe_to_run_concurrently_and_repeatedly() {
        let runs: Vec<_> = (0..4)
            .map(|_| (std::thread::spawn(egl_client), std::thread::spawn(image_loader)))
            .collect();
        let results: Vec<(bool, bool)> = runs
            .into_iter()
            .map(|(egl, image)| (egl.join().expect("EGL warm-up panicked"), image.join().expect("image warm-up panicked")))
            .collect();
        assert!(results.iter().all(|r| *r == results[0]), "{results:?}");
    }
}
