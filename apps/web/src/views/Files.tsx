import { useRef } from 'react'
import type { MavftpDirectoryEntry } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

// MAVFTP file browser. Lists/downloads/uploads/deletes files on the FC
// filesystem over the MAVLink FTP service. The runtime exposes the
// request/response primitives (listRemoteDirectory / downloadRemoteFile /
// uploadRemoteFile / deleteRemotePath); this view is presentation-only and
// drives them through callbacks. State (current path, entries, busy/error)
// lives in App.tsx because MAVFTP is request/response, not snapshot-streamed.

// Common starting points on an ArduPilot filesystem. @SYS is the virtual
// status tree (always present); /APM and /APM/scripts exist on SD-card
// builds. Operators can also type an arbitrary path.
export const MAVFTP_QUICK_PATHS = ['@SYS', '/APM', '/APM/scripts', '/APM/LOGS'] as const

export interface FilesViewProps {
  path: string
  entries: readonly MavftpDirectoryEntry[]
  loading: boolean
  error: string | undefined
  busyAction: string | undefined
  vehicleConnected: boolean
  onNavigate: (path: string) => void
  onRefresh: () => void
  onDownload: (entry: MavftpDirectoryEntry) => void
  onUpload: (file: File) => void
  onDelete: (entry: MavftpDirectoryEntry) => void
}

function formatSize(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return '—'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KiB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`
}

// Build the parent path for an "up one level" navigation. @SYS-rooted and
// absolute paths both collapse on '/'; a path with no separator goes to its
// own root marker.
function parentPath(path: string): string | undefined {
  if (path === '@SYS' || path === '/' || path === '') return undefined
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) {
    // e.g. "/APM" -> "/", "@SYS/foo" handled above; "@SYS" returned undefined
    return trimmed.startsWith('@SYS') ? '@SYS' : '/'
  }
  return trimmed.slice(0, idx)
}

export function FilesView(props: FilesViewProps) {
  const {
    path,
    entries,
    loading,
    error,
    busyAction,
    vehicleConnected,
    onNavigate,
    onRefresh,
    onDownload,
    onUpload,
    onDelete
  } = props

  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const up = parentPath(path)
  const isBusy = loading || busyAction !== undefined

  return (
    <div id="setup-panel-files">
      <Panel
        title="Files"
        subtitle="Browse, download, upload, and delete files on the flight controller's filesystem over MAVLink FTP."
      >
        {!vehicleConnected ? (
          <p className="bf-note" data-testid="files-disconnected">
            Connect to a vehicle to browse its filesystem.
          </p>
        ) : (
          <div className="files-browser">
            <div className="files-toolbar">
              <div className="files-quick-paths" role="group" aria-label="Quick paths">
                {MAVFTP_QUICK_PATHS.map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    className={`files-quick-path${path === quick ? ' is-active' : ''}`}
                    onClick={() => onNavigate(quick)}
                    disabled={isBusy}
                    data-testid={`files-quick-${quick.replace(/[^a-zA-Z0-9]/g, '')}`}
                  >
                    {quick}
                  </button>
                ))}
              </div>
              <div className="files-toolbar__actions">
                <button
                  type="button"
                  style={buttonStyle()}
                  onClick={onRefresh}
                  disabled={isBusy}
                  data-testid="files-refresh"
                >
                  {loading ? 'Loading…' : 'Refresh'}
                </button>
                <button
                  type="button"
                  style={buttonStyle('primary')}
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={isBusy}
                  data-testid="files-upload"
                >
                  {busyAction === 'files:upload' ? 'Uploading…' : 'Upload file'}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  hidden
                  data-testid="files-upload-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onUpload(file)
                    event.target.value = ''
                  }}
                />
              </div>
            </div>

            <div className="files-path" data-testid="files-current-path">
              <span className="files-path__label">Path</span>
              <code>{path}</code>
            </div>

            <div className="files-table-wrap">
            <table className="files-table" data-testid="files-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Size</th>
                  <th scope="col" className="files-table__actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {up !== undefined ? (
                  <tr className="files-row files-row--up">
                    <th scope="row">
                      <button
                        type="button"
                        className="files-link"
                        onClick={() => onNavigate(up)}
                        disabled={isBusy}
                        data-testid="files-up"
                      >
                        ../
                      </button>
                    </th>
                    <td>parent</td>
                    <td>—</td>
                    <td />
                  </tr>
                ) : null}
                {entries.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={4} className="files-empty">
                      {error ? 'Could not list this directory.' : 'Empty directory.'}
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.path} className={`files-row files-row--${entry.kind}`} data-testid={`files-row-${entry.name}`}>
                      <th scope="row">
                        {entry.kind === 'directory' ? (
                          <button
                            type="button"
                            className="files-link"
                            onClick={() => onNavigate(entry.path)}
                            disabled={isBusy}
                          >
                            {entry.name}/
                          </button>
                        ) : (
                          <span className="files-name">{entry.name}</span>
                        )}
                      </th>
                      <td>
                        <StatusBadge tone={entry.kind === 'directory' ? 'neutral' : 'success'}>
                          {entry.kind}
                        </StatusBadge>
                      </td>
                      <td className="files-size">{formatSize(entry.sizeBytes)}</td>
                      <td className="files-row__actions">
                        {entry.kind === 'file' ? (
                          <button
                            type="button"
                            style={buttonStyle()}
                            onClick={() => onDownload(entry)}
                            disabled={isBusy}
                            data-testid={`files-download-${entry.name}`}
                          >
                            Download
                          </button>
                        ) : null}
                        <button
                          type="button"
                          style={buttonStyle()}
                          onClick={() => onDelete(entry)}
                          disabled={isBusy}
                          data-testid={`files-delete-${entry.name}`}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>

            {error ? (
              <p className="switch-exercise-warning" data-testid="files-error">{error}</p>
            ) : null}

            <ul className="output-note-list">
              <li>@SYS files are virtual status reports (read-only); /APM holds real SD-card files on boards that have one.</li>
              <li>Deletes are immediate and not recoverable — double-check the path before confirming.</li>
            </ul>
          </div>
        )}
      </Panel>
    </div>
  )
}
