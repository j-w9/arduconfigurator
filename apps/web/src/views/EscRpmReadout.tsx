import type { ReactElement } from 'react'

import type { EscRpmReadoutViewModel } from '../view-models/esc-rpm-readout'

export interface EscRpmReadoutProps {
  model: EscRpmReadoutViewModel
  testId?: string
}

/**
 * Live ESC RPM beside the motor-test sliders.
 *
 * Presentational only — every judgement about what the numbers mean (live vs
 * stale vs "this vehicle has no ESC telemetry") is made in
 * buildEscRpmReadoutViewModel and arrives here already decided.
 *
 * The stale case still prints its numbers, dimmed, rather than hiding them: an
 * operator who just stopped a motor wants to see the last RPM it reached, and
 * blanking the table at the moment the motor stops is the least useful possible
 * behaviour. The dimming plus the summary line carry the "not live" part.
 */
export function EscRpmReadout({ model, testId = 'esc-rpm-readout' }: EscRpmReadoutProps): ReactElement {
  return (
    <div className="esc-rpm-readout" data-testid={testId} data-status={model.status}>
      <div className="esc-rpm-readout__header">
        <strong>ESC RPM</strong>
      </div>
      <p className="esc-rpm-readout__summary">{model.summary}</p>
      {model.rows.length > 0 ? (
        <table className={`esc-rpm-readout__table${model.status === 'stale' ? ' is-stale' : ''}`}>
          <thead>
            <tr>
              <th scope="col">Output</th>
              <th scope="col">RPM</th>
              <th scope="col">A</th>
              <th scope="col">°C</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr
                key={row.channelNumber}
                data-testid={`esc-rpm-row-${row.channelNumber}`}
                className={row.rpm === undefined ? 'is-missing' : undefined}
              >
                {/* Output first, motor second: the telemetry is indexed by
                    output, and on a board where motors do not start at OUT1
                    those two numbers differ. */}
                <th scope="row">
                  OUT{row.channelNumber}
                  {row.motorLabel ? <small> {row.motorLabel}</small> : null}
                </th>
                {/* An em dash, not a zero: 0 RPM is a real reading that means
                    "reported, and stopped", and an ESC that has never reported
                    must not be able to impersonate one. */}
                <td data-testid={`esc-rpm-value-${row.channelNumber}`}>
                  {row.rpm === undefined ? '—' : row.rpm.toLocaleString()}
                </td>
                <td>{row.currentA === undefined ? '—' : row.currentA.toFixed(1)}</td>
                <td>{row.temperatureC === undefined ? '—' : row.temperatureC}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
