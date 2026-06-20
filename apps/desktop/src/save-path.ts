import { extname, resolve, sep } from 'node:path'

/**
 * The renderer may pass `existingPath` to re-save to a file the user
 * already chose (snapshot library / backup), skipping the save dialog.
 * Only honor it when it is a `.json` inside one of the allowed roots
 * (the user's Documents / the app's userData dir) — never a raw
 * arbitrary path. Otherwise it is an arbitrary-file-write primitive
 * reachable from page content (overwrite ~/.ssh/authorized_keys, a
 * shell rc, …); callers fall back to the dialog when this returns
 * undefined. Electron-free so it is unit-testable.
 */
export function confinedExistingPath(
  existingPath: string | undefined,
  roots: string[]
): string | undefined {
  if (!existingPath || extname(existingPath).toLowerCase() !== '.json') {
    return undefined
  }
  const resolved = resolve(existingPath)
  const confined = roots.some((root) => {
    const base = resolve(root)
    return resolved === base || resolved.startsWith(base + sep)
  })
  return confined ? resolved : undefined
}
