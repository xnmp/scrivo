import { FileError } from './ports';

/** A short, human explanation of why a file operation failed. */
export function describeError(e: unknown): string {
  if (e instanceof FileError) {
    switch (e.code) {
      case 'not-found': return 'the file does not exist';
      case 'permission-denied': return 'permission denied';
      case 'not-utf8': return 'the file is not valid UTF-8 text';
      case 'is-directory': return 'it is a directory';
      case 'conflict': return 'the file changed on disk';
      case 'io': return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
