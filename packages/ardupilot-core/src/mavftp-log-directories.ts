import type { MavftpDirectoryEntry } from './mavftp.js'

/**
 * Dataflash logs are exposed over MAVFTP at different paths depending on the
 * target: real ArduPilot hardware serves them from `/APM/LOGS`, while SITL
 * serves them from `/logs`. Probe both (hardware first) so the Logs tab finds
 * the onboard logs in either environment instead of silently coming back empty.
 */
export const MAVFTP_LOG_DIRECTORIES = ['/APM/LOGS', '/logs'] as const

/**
 * List onboard log *files* by trying each candidate directory in order.
 *
 * A directory that lists but holds no logs is an ANSWER, not a failure: after
 * a LOG_ERASE that is exactly the state of the card, and reporting it as an
 * error (or falling through to a path that does not exist and throwing that
 * instead) leaves the operator unable to see that the erase worked. So the
 * first directory that LISTS wins, even when it lists nothing; a real transport
 * error is only surfaced when every candidate failed.
 */
export async function listMavftpLogFiles(
  listDirectory: (path: string) => Promise<MavftpDirectoryEntry[]>,
  directories: readonly string[] = MAVFTP_LOG_DIRECTORIES
): Promise<MavftpDirectoryEntry[]> {
  let firstError: unknown
  let listedSomething = false
  let firstEmptyListing: MavftpDirectoryEntry[] | undefined
  for (const directory of directories) {
    try {
      const entries = await listDirectory(directory)
      const files = entries.filter((entry) => entry.kind === 'file')
      if (files.length > 0) {
        return files
      }
      // Remember that this directory answered. A later candidate may still hold
      // the logs (hardware vs SITL paths), but if none do, "empty" is the
      // truthful result rather than the last candidate's error.
      if (!listedSomething) {
        listedSomething = true
        firstEmptyListing = files
      }
    } catch (error) {
      if (firstError === undefined) {
        firstError = error
      }
    }
  }
  if (listedSomething) {
    return firstEmptyListing ?? []
  }
  if (firstError !== undefined) {
    throw firstError
  }
  return []
}
