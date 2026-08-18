import { useEffect, useState, type ReactElement } from 'react'

import { buttonStyle, StatusBadge } from '@arduconfig/ui-kit'

import type { LogUploadFormModel } from '../view-models/log-upload-form'

export interface LogServerPanelProps {
  signedInAs?: { serverUrl: string; username: string }
  rememberedServerUrl: string
  rememberedUsername: string
  signingIn: boolean
  signInError?: string
  onSignIn: (serverUrl: string, username: string, password: string) => void
  onSignOut: () => void
}

/**
 * Sign-in for the operator's own log server.
 *
 * The password field is uncontrolled-by-design in the sense that matters: it is
 * held in local state, passed once to the sign-in call, and cleared immediately.
 * Nothing persists it — see log-upload/session-storage.ts, which stores only the
 * address and username.
 */
export function LogServerPanel(props: LogServerPanelProps): ReactElement {
  const { signedInAs, rememberedServerUrl, rememberedUsername, signingIn, signInError, onSignIn, onSignOut } = props
  const [serverUrl, setServerUrl] = useState(rememberedServerUrl)
  const [username, setUsername] = useState(rememberedUsername)
  const [password, setPassword] = useState('')

  // The remembered values arrive after mount (they are read from storage in an
  // effect), so seed the fields when they land rather than leaving them blank.
  useEffect(() => {
    setServerUrl((current) => (current.length === 0 ? rememberedServerUrl : current))
  }, [rememberedServerUrl])
  useEffect(() => {
    setUsername((current) => (current.length === 0 ? rememberedUsername : current))
  }, [rememberedUsername])

  if (signedInAs) {
    return (
      <div className="log-server-panel" data-testid="log-server-panel">
        <div className="log-server-panel__copy">
          <strong>Log server</strong>
          <p>
            Signed in as <code>{signedInAs.username}</code> at <code>{signedInAs.serverUrl}</code>. Uploads land in
            your folder there. Anyone signed in to that server can read them; only you can delete your own.
          </p>
        </div>
        <div className="button-row">
          <StatusBadge tone="success">connected</StatusBadge>
          <button type="button" style={buttonStyle()} data-testid="log-server-sign-out" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="log-server-panel"
      data-testid="log-server-panel"
      onSubmit={(event) => {
        event.preventDefault()
        onSignIn(serverUrl, username, password)
        // Cleared on submit, not on success: the value has already been handed
        // to the caller, and leaving it in a DOM node for a failed attempt is
        // the one place it would linger.
        setPassword('')
      }}
    >
      <div className="log-server-panel__copy">
        <strong>Upload logs to your own server</strong>
        <p>
          Sign in to an ArduLogs server to upload flight logs straight from here. Your password is used to sign in and
          is never stored — only the address and username are remembered.
        </p>
      </div>
      <div className="log-server-panel__fields">
        <label>
          <span>Server address</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="logs.example.com"
            data-testid="log-server-url"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
          />
        </label>
        <label>
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            data-testid="log-server-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            data-testid="log-server-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button
          type="submit"
          style={buttonStyle('primary')}
          data-testid="log-server-sign-in"
          disabled={signingIn || serverUrl.trim().length === 0 || username.trim().length === 0}
        >
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
      {signInError ? (
        <p className="log-server-panel__error" data-testid="log-server-error">
          {signInError}
        </p>
      ) : null}
    </form>
  )
}

export interface LogUploadDialogProps {
  form: LogUploadFormModel
  busy: boolean
  phase: 'idle' | 'reading' | 'sending' | 'done' | 'error'
  progressRatio?: number
  onCancel: () => void
  onSubmit: (answers: { flightDate: string; note: string }) => void
}

/** The two questions only the operator can answer, plus what we already know. */
export function LogUploadDialog(props: LogUploadDialogProps): ReactElement {
  const { form, busy, phase, progressRatio, onCancel, onSubmit } = props
  const [flightDate, setFlightDate] = useState(form.flightDate)
  const [note, setNote] = useState('')

  return (
    <div className="log-upload-dialog" data-testid="log-upload-dialog" role="dialog" aria-label="Upload log">
      <div className="log-upload-dialog__header">
        <strong>Upload this log</strong>
        <span className="log-upload-dialog__file">{form.metadata.fileName}</span>
      </div>

      <label>
        <span>Flight date</span>
        <input
          type="date"
          data-testid="log-upload-flight-date"
          value={flightDate}
          onChange={(event) => setFlightDate(event.target.value)}
        />
      </label>

      <label>
        <span>Note</span>
        <textarea
          rows={3}
          placeholder="Anything worth remembering — conditions, what you changed, what went wrong."
          data-testid="log-upload-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      {/* Shown, not hidden: the operator should be able to see what is being
          filed alongside their log before it is sent. */}
      <div className="log-upload-dialog__autofill">
        <span>Attached automatically</span>
        <div className="config-pills">
          {form.autofilled.map((item) => (
            <span key={item.label}>
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      </div>

      {phase === 'reading' ? (
        <p className="log-upload-dialog__progress" data-testid="log-upload-progress">
          Reading the log off the flight controller
          {progressRatio !== undefined ? ` — ${Math.round(progressRatio * 100)}%` : ''}…
        </p>
      ) : null}
      {phase === 'sending' ? (
        <p className="log-upload-dialog__progress" data-testid="log-upload-progress">
          Sending it to the server…
        </p>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          style={buttonStyle('primary')}
          data-testid="log-upload-submit"
          disabled={busy}
          onClick={() => onSubmit({ flightDate, note })}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        <button type="button" style={buttonStyle()} data-testid="log-upload-cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
