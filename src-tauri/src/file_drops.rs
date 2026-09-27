//! Keep native file drops received before the deferred frontend listener is ready.
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{DragDropEvent, Emitter, State, WebviewEvent, WebviewWindow};

#[derive(Clone, Debug, Serialize)]
pub struct FileDrop {
    paths: Vec<String>,
    position: Position,
}

#[derive(Clone, Copy, Debug, Serialize)]
struct Position {
    x: f64,
    y: f64,
}

#[derive(Default)]
struct Queue {
    active: bool,
    pending: Vec<FileDrop>,
}

#[derive(Clone, Default)]
pub struct FileDropState(Arc<Mutex<Queue>>);

impl FileDropState {
    fn accept(&self, drop: FileDrop) -> Option<FileDrop> {
        let mut queue = self.0.lock().unwrap();
        if queue.active { Some(drop) } else { queue.pending.push(drop); None }
    }

    fn activate(&self) -> Vec<FileDrop> {
        let mut queue = self.0.lock().unwrap();
        queue.active = true;
        std::mem::take(&mut queue.pending)
    }
}

pub fn observe(window: &WebviewWindow, state: FileDropState) {
    let target = window.clone();
    window.on_webview_event(move |event| {
        if let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, position }) = event {
            let drop = FileDrop {
                paths: paths.iter().map(|path| path.to_string_lossy().into_owned()).collect(),
                position: Position { x: position.x, y: position.y },
            };
            if let Some(drop) = state.accept(drop) {
                let _ = target.emit("scrivo-file-drop", drop);
            }
        }
    });
}

#[tauri::command]
pub fn activate_file_drops(state: State<'_, FileDropState>) -> Vec<FileDrop> {
    state.activate()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_drops_are_delivered_once_and_later_drops_are_live() {
        let state = FileDropState::default();
        let drop = FileDrop { paths: vec!["/tmp/a.png".into()], position: Position { x: 3.0, y: 4.0 } };
        assert!(state.accept(drop.clone()).is_none());
        assert_eq!(state.activate().len(), 1);
        assert!(state.activate().is_empty());
        assert_eq!(state.accept(drop).unwrap().paths, ["/tmp/a.png"]);
    }
}
