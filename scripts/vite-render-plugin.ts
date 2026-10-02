// Dev-server bridge to the backend's markdown renderer, for the browser build
// (`bun run dev`, Playwright). The page POSTs text to /__scrivo/render and gets exactly
// what the app's `render_markdown` command returns, from the same Rust code, via the
// `scrivo-render` CLI (built by `bun run build:render`).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

const ASSET_PREFIX = '/__scrivo/asset/';
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
};

function renderer(root: string): string | null {
  const exe = process.platform === 'win32' ? 'scrivo-render.exe' : 'scrivo-render';
  for (const profile of ['release', 'debug']) {
    const candidate = path.join(root, 'src-tauri', 'target', profile, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

function fail(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain');
  res.end(message);
}

function configureRenderer(server: Pick<ViteDevServer, 'config' | 'middlewares'>) {
  const root = server.config.root;
  server.middlewares.use('/__scrivo/render', async (req, res) => {
    if (req.method !== 'POST') return fail(res, 405, 'POST markdown to render it');
    const exe = renderer(root);
    if (!exe) return fail(res, 500, 'scrivo-render is not built: run `bun run build:render`');
    const docPath = decodeURIComponent(String(req.headers['x-scrivo-path'] ?? ''));
    const args = ['--asset-prefix', ASSET_PREFIX];
    if (docPath) args.push('--base-dir', path.posix.dirname(docPath));
    const body = await readBody(req);
    const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('close', (code) => {
      if (code !== 0) return fail(res, 500, Buffer.concat(err).toString() || `scrivo-render exited with ${code}`);
      res.setHeader('content-type', 'application/json');
      res.end(Buffer.concat(out));
    });
    child.stdin.end(body);
  });
  // Local images referenced by rendered documents (browser testing only).
  server.middlewares.use(ASSET_PREFIX, (req, res) => {
    const file = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]!);
    if (!IMAGE.test(file) || !existsSync(file)) return fail(res, 404, 'not found');
    res.setHeader('content-type', MIME[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
}

export function scrivoRenderDev(): Plugin {
  return {
    name: 'scrivo-render-dev',
    apply: 'serve',
    configureServer: configureRenderer,
    configurePreviewServer: configureRenderer,
  };
}
