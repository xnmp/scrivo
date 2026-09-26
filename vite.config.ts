import { defineConfig } from 'vite';
import { scrivoRenderDev } from './scripts/vite-render-plugin';

export default defineConfig({
  clearScreen: false,
  plugins: [scrivoRenderDev()],
  server: { port: 1420, strictPort: true },
  build: {
    target: 'safari16',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Shims patch globals that libraries read when they load (CodeMirror checks for
        // requestIdleCallback once). In their own chunk, imported first by the entry, they
        // run before any library chunk; inlined into the entry they would run after them.
        codeSplitting: { groups: [{ name: 'shims', test: /[\\/]src[\\/]shims[\\/]/ }] },
      },
    },
  },
});
