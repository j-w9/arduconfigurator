// "Pick from vehicle" for any card that takes a dataflash log.
//
// The vehicle is already holding the log. Making the operator download it and
// hand it back through a file picker is a round trip through the filesystem
// for a file that is right there. One component, so every "Choose … log
// (.bin)" button has the same vehicle-side option next to it.

import { type ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

/** The slice of the onboard-logs hook a picker needs (see useOnboardLogs). */
export interface OnboardLogPickerLogs {
  logs: readonly { id: number; sizeBytes: number }[]
  status: string
  list: () => void
  fetchBytes: (id: number) => Promise<Uint8Array | undefined>
  logNamesById?: ReadonlyMap<number, string>
}

export interface OnboardLogPickerProps {
  onboardLogs: OnboardLogPickerLogs
  /** The host card is already reading or analysing something. */
  busy: boolean
  /** Prefix for the data-testids: `<prefix>-list-onboard-logs`, `<prefix>-onboard-log-select`. */
  testIdPrefix: string
  /** Held true while a log is read off the vehicle. */
  onBusy: (busy: boolean) => void
  /** The log's bytes and a display name, once read. */
  onBytes: (bytes: Uint8Array, name: string) => void | Promise<void>
  onError: (message: string | undefined) => void
}

export function OnboardLogPicker({
  onboardLogs,
  busy,
  testIdPrefix,
  onBusy,
  onBytes,
  onError
}: OnboardLogPickerProps): ReactElement {
  return (
    <div className="onboard-log-picker" data-testid={`${testIdPrefix}-onboard-logs`}>
      {onboardLogs.logs.length === 0 ? (
        <button
          type="button"
          style={buttonStyle()}
          data-testid={`${testIdPrefix}-list-onboard-logs`}
          disabled={busy || onboardLogs.status === 'listing'}
          onClick={onboardLogs.list}
        >
          {onboardLogs.status === 'listing' ? 'Reading log list…' : 'Pick from vehicle'}
        </button>
      ) : (
        <label className="scoped-editor-field scoped-editor-field--compact">
          <span>From the vehicle</span>
          <select
            data-testid={`${testIdPrefix}-onboard-log-select`}
            disabled={busy}
            defaultValue=""
            onChange={(event) => {
              const id = Number(event.target.value)
              event.target.value = ''
              if (!Number.isFinite(id)) return
              void (async () => {
                onBusy(true)
                onError(undefined)
                try {
                  const bytes = await onboardLogs.fetchBytes(id)
                  if (!bytes) {
                    onError('That log could not be read from the vehicle.')
                    return
                  }
                  await onBytes(bytes, onboardLogs.logNamesById?.get(id) ?? `log ${id}.bin`)
                } catch (caught) {
                  onError(caught instanceof Error ? caught.message : 'That log could not be read from the vehicle.')
                } finally {
                  onBusy(false)
                }
              })()
            }}
          >
            <option value="">Choose a log…</option>
            {onboardLogs.logs.map((log) => (
              <option key={log.id} value={log.id}>
                {onboardLogs.logNamesById?.get(log.id) ?? `Log ${log.id}`} ({(log.sizeBytes / 1024 / 1024).toFixed(1)} MB)
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
