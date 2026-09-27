import type { FileSystem, RecoveryCopy } from './ports';

/** Match recovery copies by the same file identity used for tab deduplication. */
export async function matchingRecoveryCopies(
  fs: Pick<FileSystem, 'identity'>,
  path: string | null,
  copies: readonly RecoveryCopy[],
): Promise<RecoveryCopy[]> {
  if (path === null) return copies.filter((copy) => copy.path === null);
  const target = await fs.identity(path).catch(() => null);
  const matched = await Promise.all(copies.map(async (copy) => {
    if (copy.path === path) return true;
    if (copy.path === null || target === null) return false;
    return fs.identity(copy.path).then((identity) => identity === target, () => false);
  }));
  return copies.filter((_, index) => matched[index]);
}
