import { Facet, StateEffect } from '@codemirror/state';
import { resolveTarget } from '../../domain/links';

/** What rendering needs to know about the outside world. */
export interface PreviewEnv {
  /** Directory of the open document, for relative image paths. */
  readonly docDir: string | null;
  /** Turns an absolute file path into a URL the webview may load. */
  readonly fileUrl: (path: string) => string;
}

export const previewEnv = Facet.define<PreviewEnv, PreviewEnv>({
  combine: (values) => values[values.length - 1] ?? { docDir: null, fileUrl: (p) => p },
});

/** Ask the live preview to rebuild (e.g. after async resources arrived). */
export const refreshPreview = StateEffect.define<null>();

/** URL for an image destination as written in the document, or null if unresolvable. */
export function imageUrl(env: PreviewEnv, raw: string): string | null {
  const target = resolveTarget(raw, env.docDir);
  if (!target) return null;
  return target.kind === 'url' ? target.url : env.fileUrl(target.path);
}
