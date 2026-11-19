import path from 'node:path';

/**
 * Resolve `filePath` relatif terhadap `base`, tapi hanya bila hasilnya tetap di
 * dalam `base`. Mengembalikan null bila path mencoba keluar (path traversal).
 */
export function resolveClipPath(
  base: string,
  filePath: string,
): string | null {
  const root = path.resolve(base);
  const target = path.resolve(root, filePath);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
