import { useState, type ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import type { ArtifactUploadStatus } from '../hooks/use-artifact-upload'
import {
  artifactUploadNameFromFileName,
  resolveArtifactUploadFileName
} from '../view-models/artifact-upload-target'

/**
 * "Upload to log server" beside an export action.
 *
 * Renders nothing at all when there is no log-server session. A button that
 * only ever produces "sign in first" is worse than no button: it advertises a
 * capability the operator has not set up, on tabs most of them never will.
 *
 * Clicking it opens the same small form a log upload gets, for the same reason:
 * the name is what this file is called a year later, and the one moment the
 * operator knows what it should say is now. The derived name is prefilled, so
 * accepting it is still one extra click and nothing has to be typed. The folder
 * is shown but not editable — exactly as for logs, config files file under the
 * aircraft they came off, or they stop lining up with its flights.
 */
export interface UploadToLogServerButtonProps {
  available: boolean
  serverUrl?: string
  status: ArtifactUploadStatus
  /** Called with the normalised filename and the operator's note. */
  onUpload: (answers: { fileName: string; note: string }) => void
  /** The derived name, prefilled and editable. Carries the extension. */
  defaultFileName: string
  /** Where it lands on the server. Shown for confidence, not editable. */
  folder?: string
  /** What is being uploaded, for the title and the testid. */
  label: string
  testId: string
  disabled?: boolean
}

export function UploadToLogServerButton(props: UploadToLogServerButtonProps): ReactElement | null {
  const { available, serverUrl, status, onUpload, defaultFileName, folder, label, testId, disabled = false } = props
  const [open, setOpen] = useState(false)
  // undefined = untouched, so the field still tracks the derived name; '' is a
  // deliberately cleared field, which must stay cleared while they retype.
  const [name, setName] = useState<string | undefined>(undefined)
  const [note, setNote] = useState('')

  if (!available) {
    return null
  }
  const busy = status.kind === 'uploading'
  const editedName = name ?? artifactUploadNameFromFileName(defaultFileName)
  const resolved = resolveArtifactUploadFileName(defaultFileName, editedName)

  return (
    <>
      <button
        type="button"
        style={buttonStyle()}
        data-testid={testId}
        onClick={() => {
          setName(undefined)
          setNote('')
          setOpen((previous) => !previous)
        }}
        disabled={disabled || busy}
        title={`Upload ${label} to ${serverUrl ?? 'your log server'}, filed beside that aircraft's flights`}
      >
        {busy ? 'Uploading…' : 'Upload to log server'}
      </button>

      {open && !busy ? (
        <div
          className="log-upload-dialog log-upload-dialog--inline"
          data-testid={`${testId}-form`}
          role="group"
          aria-label={`Upload ${label}`}
        >
          <div className="log-upload-dialog__header">
            <strong>Upload {label}</strong>
            <span className="log-upload-dialog__file">{resolved}</span>
          </div>

          <label>
            <span>Name</span>
            <input
              type="text"
              data-testid={`${testId}-name`}
              value={editedName}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label>
            <span>Note</span>
            <textarea
              rows={2}
              placeholder="Anything worth remembering — what you changed, and why."
              data-testid={`${testId}-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {folder ? (
            <div className="log-upload-dialog__autofill">
              <span>Filed under</span>
              <div className="config-pills">
                <span data-testid={`${testId}-folder`}>{folder}</span>
              </div>
            </div>
          ) : null}

          <div className="button-row">
            <button
              type="button"
              style={buttonStyle('primary')}
              data-testid={`${testId}-submit`}
              disabled={disabled}
              onClick={() => {
                setOpen(false)
                onUpload({ fileName: resolved, note })
              }}
            >
              Upload
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid={`${testId}-cancel`}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {status.kind === 'done' || status.kind === 'error' ? (
        <p
          className={status.kind === 'error' ? 'switch-exercise-warning' : 'success-copy'}
          data-testid={`${testId}-status`}
        >
          {status.message}
        </p>
      ) : null}
    </>
  )
}
