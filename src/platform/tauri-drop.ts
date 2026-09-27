import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { WindowPort } from '../app/ports';

interface NativeDrop {
  readonly paths: readonly string[];
  readonly position: { readonly x: number; readonly y: number };
}

/** Tauri reports webview-relative physical pixels; editor hit testing uses CSS pixels. */
export async function onFilesDropped(handler: Parameters<WindowPort['onFilesDropped']>[0]): Promise<void> {
  const deliver = (payload: NativeDrop) => {
    const scale = window.devicePixelRatio || 1;
    return handler({
      paths: payload.paths,
      position: { x: payload.position.x / scale, y: payload.position.y / scale },
    });
  };
  let ready = false;
  const liveBeforeDrain: NativeDrop[] = [];
  let tail = Promise.resolve();
  const enqueue = (drop: NativeDrop) => {
    tail = tail.catch(() => undefined).then(() => deliver(drop));
    return tail;
  };
  await listen<NativeDrop>('scrivo-file-drop', ({ payload }) => {
    if (ready) void enqueue(payload);
    else liveBeforeDrain.push(payload);
  });
  const pending = await invoke<NativeDrop[]>('activate_file_drops');
  for (const drop of [...pending, ...liveBeforeDrain]) void enqueue(drop);
  ready = true;
  await tail;
}
