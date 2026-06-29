import type { MavftpDirectoryEntry } from './mavftp.js'

/**
 * Dataflash logs are exposed over MAVFTP at different paths depending on the
 * target: real ArduPilot hardware serves them from `/APM/LOGS`, while SITL
 * serves them from `/logs`. Probe both (hardware first) so the Logs tab finds
 * the onboard logs in either environment instead of silently coming back empty.
 */
export const MAVFTP_LOG_DIRECTORIES = ['/APM/LOGS', '/logs'] as const

/**
 * List onboard log *files* by trying each candidate directory in order and
 * returning the first that yields files. A directory that's simply absent
 * (NAK / empty) is skipped; a real transport error is only surfaced when every
 * candidate failed (so a dead link still reports, but a missing `/APM/LOGS` on
 * SITL transparently falls through to `/logs`).
 */
export async function listMavftpLogFiles(
  listDirectory: (path: string) => Promise<MavftpDirectoryEntry[]>,
  directories: readonly string[] = MAVFTP_LOG_DIRECTORIES
): Promise<MavftpDirectoryEntry[]> {
  let firstError: unknown
  for (const directory of directories) {
    try {
      const files = (await listDirectory(directory)).filter((entry) => entry.kind === 'file')
      if (files.length > 0) {
        return files
      }
    } catch (error) {
      if (firstError === undefined) {
        firstError = error
      }
    }
  }
  if (firstError !== undefined) {
    throw firstError
  }
  return []
}
