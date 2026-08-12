import type { ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import type { ArtifactUploadStatus } from '../hooks/use-artifact-upload'

/**
 * "Upload to log server" beside an export action.
 *
 * Renders nothing at all when there is no log-server session. A button that
 * only ever produces "sign in first" is worse than no button: it advertises a
 * capability the operator has not set up, on tabs most of them never will.
 */
export interface UploadToLogServerButtonProps {
  available: boolean
  serverUrl?: string
  status: ArtifactUploadStatus
  onUpload: () => void
  /** What is being uploaded, for the title and the testid. */
  label: string
  testId: string
  disabled?: boolean
}

export function UploadToLogServerButton(props: UploadToLogServerButtonProps): ReactElement | null {
  const { available, serverUrl, status, onUpload, label, testId, disabled = false } = props
  if (!available) {
    return null
  }
  const busy = status.kind === 'uploading'
  return (
    <>
      <button
        type="button"
        style={buttonStyle()}
        data-testid={testId}
        onClick={onUpload}
        disabled={disabled || busy}
        title={`Upload ${label} to ${serverUrl ?? 'your log server'}, filed beside that aircraft's flights`}
      >
        {busy ? 'Uploading…' : 'Upload to log server'}
      </button>
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
