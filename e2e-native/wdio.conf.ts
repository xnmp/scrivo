// Native E2E: launches the real Tauri debug binary (WebKitGTK) via tauri-driver +
// WebKitWebDriver and drives it with WebdriverIO. Keep this suite small — it is
// slow (one process launch per spec) and only covers what the Playwright suite
// (against the Vite dev server + in-memory platform) cannot: real file I/O, the
// real WebView, the real asset protocol.
//
// Run only under xvfb-run + dbus-run-session + with-wm.sh (see package.json
// script + docs/ARCHITECTURE.md "Testing"). Never on a live desktop session.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureBySpec } from './fixtures';
import { state } from './state';

const here = path.dirname(fileURLToPath(import.meta.url));
const application = path.resolve(here, '..', 'src-tauri', 'target', 'debug', 'scrivo');

const tauriDriverBin = path.join(process.env.HOME ?? '', '.cargo', 'bin', 'tauri-driver');
const logDir = path.join(here, 'logs');

// Another project on this machine may already have a tauri-driver/WebKitWebDriver
// pair bound to the default 4444/4445 ports at the same time, so both ports are
// picked fresh at runtime instead of hardcoded. WDIO's `port` option (below) is set
// from the same value tauri-driver is told to `--port`.
function reservePort(): Promise<{ port: number; server: net.Server }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ port, server });
    });
  });
}

// Hold both sockets until both ports are chosen, so the OS cannot return the
// same ephemeral port for the second request.
const driverReservation = await reservePort();
const nativeReservation = await reservePort();
const driverPort = driverReservation.port;
const nativePort = nativeReservation.port;
await Promise.all([driverReservation, nativeReservation].map(({ server }) =>
  new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
));

let driverProcess: ChildProcess | undefined;

function groupIsEmpty(pgid: number): boolean {
  try {
    // Signal 0 sends nothing but still validates the target exists (ESRCH if not).
    process.kill(-pgid, 0);
    return false;
  } catch {
    return true;
  }
}

async function waitForGroupExit(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (groupIsEmpty(pgid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return groupIsEmpty(pgid);
}

async function stopDriver(): Promise<void> {
  const proc = driverProcess;
  driverProcess = undefined;
  if (!proc || proc.pid === undefined) return;
  const pgid = proc.pid;
  // tauri-driver is spawned in its own process group (detached); WebKitWebDriver
  // launches the actual app as its child, so killing only the driver PID can leak
  // the app process, and tauri-driver itself dying doesn't guarantee WebKitWebDriver
  // (which can take longer to shut down, and still holds the native WebDriver
  // session/port) has actually exited yet. Wait for the whole group to be gone —
  // not just tauri-driver's own 'exit' event — before starting the next session,
  // or the next spec's fresh WebKitWebDriver can collide with a still-dying one
  // ("Maximum number of active sessions").
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    return; // group already gone
  }
  if (await waitForGroupExit(pgid, 5000)) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    return;
  }
  await waitForGroupExit(pgid, 3000);
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      // No browserName: tauri-driver fills it in for WebKitGTK. WDIO v9 defaults
      // to WebDriver BiDi (webSocketUrl), which WebKitWebDriver rejects with
      // "Failed to match capabilities" — enforce classic.
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': { application, args: [] },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 3,
  hostname: '127.0.0.1',
  port: driverPort,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },

  onPrepare: () => {
    mkdirSync(logDir, { recursive: true });
  },

  beforeSession: async (_config, capabilities, specs) => {
    const specFile = specs?.[0];
    const base = specFile ? path.basename(specFile) : undefined;
    const setup = base ? fixtureBySpec[base] : undefined;
    if (!setup) {
      throw new Error(`e2e-native: no fixture registered for spec file "${specFile}"`);
    }
    const fixture = setup();
    state.fixture = fixture;

    // Mutate in place: WDIO's runner passes this same object through to the real
    // "New Session" request made after beforeSession returns.
    (capabilities as Record<string, unknown>)['tauri:options'] = {
      application,
      args: [...(fixture.launchArgs ?? []), fixture.docPath],
    };

    driverProcess = spawn(
      tauriDriverBin,
      ['--port', String(driverPort), '--native-port', String(nativePort)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    const logPath = path.join(logDir, `${base}.tauri-driver.log`);
    const { createWriteStream } = await import('node:fs');
    const logStream = createWriteStream(logPath, { flags: 'a' });
    // A write can land after `.end()` below (stdout/stderr 'data' and the process
    // 'exit' event race); without this handler that throws an uncaught
    // ERR_STREAM_WRITE_AFTER_END that kills the whole worker.
    logStream.on('error', () => {});
    driverProcess.stdout?.pipe(logStream, { end: false });
    driverProcess.stderr?.pipe(logStream, { end: false });
    driverProcess.once('exit', () => {
      driverProcess?.stdout?.unpipe(logStream);
      driverProcess?.stderr?.unpipe(logStream);
      logStream.end();
    });

    // Give tauri-driver a moment to bind its port before WDIO's HTTP client
    // starts sending it requests.
    await new Promise((resolve) => setTimeout(resolve, 500));
  },

  afterSession: async () => {
    await stopDriver();
  },
};

// Best-effort: remove this run's fixture directory after the suite exits so
// repeated local runs don't accumulate temp files under $HOME.
process.once('exit', () => {
  if (state.fixture?.dir) {
    try {
      rmSync(state.fixture.dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
