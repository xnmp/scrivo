// Shared, process-local state between wdio.conf.ts's `beforeSession` hook and the
// spec file it launches the app for. WDIO's local runner puts the config and the
// one spec file it is driving in the same worker process, so a plain module
// singleton is enough — no IPC needed.
import type { Fixture } from './fixtures';

export const state: { fixture?: Fixture; driverPid?: number } = {};
