// Lossless conversion between file text and editor text.
//
// The editor works on '\n'-separated text without a byte-order mark. To write back
// exactly what was read we remember the file's line ending and BOM at load time and
// re-apply them on save.

export type Eol = '\n' | '\r\n' | '\r';

export interface TextFormat {
  readonly eol: Eol;
  readonly bom: boolean;
  /** The file mixed line-ending styles; saving normalises them to `eol`. */
  readonly mixedEol: boolean;
}

export interface DecodedText {
  /** '\n'-separated, leading BOM removed. */
  readonly text: string;
  readonly format: TextFormat;
}

export const DEFAULT_FORMAT: TextFormat = { eol: '\n', bom: false, mixedEol: false };

const BOM = '﻿';

interface EolCounts {
  readonly lf: number;
  readonly crlf: number;
  readonly cr: number;
}

export function countEols(text: string): EolCounts {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (c === 10 /* \n */) {
      lf++;
    }
  }
  return { lf, crlf, cr };
}

/** Most frequent line ending; ties and line-less text resolve to '\n'. */
function dominantEol({ lf, crlf, cr }: EolCounts): Eol {
  if (crlf > lf && crlf >= cr) return '\r\n';
  if (cr > lf && cr > crlf) return '\r';
  return '\n';
}

export function decode(raw: string): DecodedText {
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;
  const counts = countEols(body);
  const kinds = [counts.lf, counts.crlf, counts.cr].filter((n) => n > 0).length;
  return {
    text: kinds === 0 || (counts.lf > 0 && kinds === 1) ? body : body.replace(/\r\n?/g, '\n'),
    format: { eol: dominantEol(counts), bom, mixedEol: kinds > 1 },
  };
}

/** Inverse of `decode` for any text whose line endings were not mixed. */
export function encode(text: string, format: TextFormat): string {
  const body = format.eol === '\n' ? text : text.replace(/\n/g, format.eol);
  return format.bom ? BOM + body : body;
}
