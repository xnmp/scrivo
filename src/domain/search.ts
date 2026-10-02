/** Rank ordered-character matches; complete words and prefixes come first. */
export function searchScore(query: string, value: string): number | null {
  const text = value.toLocaleLowerCase(), words = query.toLocaleLowerCase().trim().split(/\s+/);
  let score = 0;
  for (const word of words) {
    if (!word) continue;
    const exact = text.indexOf(word);
    if (exact >= 0) { score += exact; continue; }
    let cursor = 0, gaps = 0;
    for (const character of word) {
      const found = text.indexOf(character, cursor); if (found < 0) return null;
      gaps += found - cursor; cursor = found + 1;
    }
    score += 100 + gaps;
  }
  return score;
}
