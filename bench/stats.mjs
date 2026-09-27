export function median(values) {
  if (values.length === 0) throw new Error('median requires observations');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const minimumPairs = (rounds) => Math.ceil(rounds * 0.8);
