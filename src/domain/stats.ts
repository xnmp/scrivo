// Document statistics shown in the status bar.
//
// A single pass over char codes: this runs on every pause in typing, so it avoids
// regexes, allocation and the need to join the document into one string.

export interface TextStats {
  readonly words: number;
  readonly characters: number;
}

const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a);

// Scripts written without spaces count one word per character (as Typora and most
// word processors do): kana, CJK ideographs, Hangul.
const isCjk = (c: number) =>
  (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) ||
  (c >= 0xf900 && c <= 0xfaff) || (c >= 0xac00 && c <= 0xd7af);

// Joiners stay inside a word ("don't", "stop-me", "snake_case") but can't start one.
const isJoiner = (c: number) => c === 39 || c === 45 || c === 95 || c === 0x2019;

// ASCII symbols/punctuation, general punctuation, CJK and fullwidth punctuation, and
// astral characters (emoji) neither start nor continue words.
const isPunct = (c: number) =>
  (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126) ||
  (c >= 0x2010 && c <= 0x206f) || (c >= 0x3001 && c <= 0x303f) || (c >= 0xff01 && c <= 0xff0f) ||
  (c >= 0xd800 && c <= 0xdfff);

/** Stats over text given as chunks (e.g. CodeMirror's `doc.iter()`), or one string. */
export function textStats(text: string | Iterable<string>): TextStats {
  let words = 0;
  let characters = 0;
  let inWord = false;
  let afterHighSurrogate = false;
  for (const chunk of typeof text === 'string' ? [text] : text) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      // A surrogate pair is one character, even when a chunk boundary splits it.
      const pairTail = afterHighSurrogate && c >= 0xdc00 && c <= 0xdfff;
      afterHighSurrogate = c >= 0xd800 && c <= 0xdbff;
      if (pairTail) continue;
      if (isSpace(c)) {
        inWord = false;
        continue;
      }
      characters++;
      if (isCjk(c)) {
        words++;
        inWord = false;
      } else if (isJoiner(c)) {
        // keeps the current word going, if any
      } else if (isPunct(c)) {
        inWord = false;
      } else if (!inWord) {
        words++;
        inWord = true;
      }
    }
  }
  return { words, characters };
}
