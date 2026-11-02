// Peripherals ▸ Compass: the order ArduPilot uses the compasses in, decoded.
//
// The firmware's three lists (PRIOn_ID, DEV_IDn, DEV_ID4..8) are one table
// here: a row per priority with the device named in words, whether it was
// found this boot, and the settings that travel with it. Move up / down and
// Remove stage PRIO drafts through the ordinary apply path; the PRIO
// parameters are reboot-required in the catalog, so Apply ends in the usual
// reboot follow-up. Nothing here writes a DEV_ID: those are the firmware's.

import type { ReactElement } from 'react'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'

import { DraftReviewBadge } from '../views/DraftReviewBadge'
import type { CompassOrderModel, CompassOrderRow } from '../view-models/compass-order'

export interface CompassOrderCardProps {
  model: CompassOrderModel
  stagedDrafts: readonly ParameterDraftEntry[]
  invalidDrafts: readonly ParameterDraftEntry[]
  busyAction: string | undefined
  onSwap: (a: 1 | 2 | 3, b: 1 | 2 | 3) => void
  onRemove: (priority: 1 | 2 | 3) => void
}

function stateBadge(row: CompassOrderRow): ReactElement {
  switch (row.state) {
    case 'detected':
      return <StatusBadge tone="success">found</StatusBadge>
    case 'missing':
      return <StatusBadge tone="danger">not found</StatusBadge>
    default:
      return <StatusBadge tone="neutral">empty</StatusBadge>
  }
}

export function CompassOrderCard({
  model,
  stagedDrafts,
  invalidDrafts,
  busyAction,
  onSwap,
  onRemove
}: CompassOrderCardProps): ReactElement | null {
  if (!model.supported) {
    return null
  }
  const busy = busyAction !== undefined
  const ghosts = model.rows.filter((row) => row.state === 'missing')

  return (
    <div className="scoped-review-card scoped-review-card--compact compass-order" data-testid="compass-order">
      <div className="switch-exercise-card__header">
        <div>
          <strong>Compass order</strong>
        </div>
        <DraftReviewBadge staged={stagedDrafts.length} invalid={invalidDrafts.length} />
      </div>

      {ghosts.length > 0 ? (
        <p className="bf-note bf-note--warning" data-testid="compass-order-ghost">
          {ghosts.length === 1 ? 'Priority ' + ghosts[0].priority + ' names a compass' : 'Some priorities name compasses'} that
          the board did not find this boot. Until it is removed, pre-arm reports a missing compass. Remove it and
          reboot.
        </p>
      ) : null}

      <table className="compass-order__table">
        <thead>
          <tr>
            <th>#</th>
            <th>Compass</th>
            <th>Status</th>
            <th>Settings</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.priority} data-testid={`compass-order-row-${row.priority}`} data-state={row.state}>
              <td className="compass-order__priority">{row.priority}</td>
              <td>
                {row.device ? (
                  <>
                    <strong>{row.device.sensor}</strong>
                    <small>{row.device.location}</small>
                  </>
                ) : (
                  <small>The next compass found takes this slot.</small>
                )}
              </td>
              <td>{stateBadge(row)}</td>
              <td>
                {row.state === 'detected' ? (
                  <small>
                    {row.use ? 'Used' : 'Not used'} · {row.external ? 'External' : 'Internal'} ·{' '}
                    {row.calibrated ? 'Calibrated' : 'Not calibrated'}
                    {row.slot !== undefined && row.slot !== row.priority ? ` · settings in slot ${row.slot} until reboot` : ''}
                  </small>
                ) : null}
              </td>
              <td className="compass-order__actions">
                <button
                  type="button"
                  style={buttonStyle()}
                  disabled={busy || row.priority === 1 || row.state === 'empty'}
                  onClick={() => onSwap(row.priority, (row.priority - 1) as 1 | 2 | 3)}
                  data-testid={`compass-order-up-${row.priority}`}
                  aria-label={`Move priority ${row.priority} up`}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  style={buttonStyle()}
                  disabled={busy || row.priority === 3 || row.state === 'empty' || model.rows[row.priority]?.state === 'empty'}
                  onClick={() => onSwap(row.priority, (row.priority + 1) as 1 | 2 | 3)}
                  data-testid={`compass-order-down-${row.priority}`}
                  aria-label={`Move priority ${row.priority} down`}
                  title="Move down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  style={buttonStyle()}
                  disabled={busy || row.state === 'empty'}
                  onClick={() => onRemove(row.priority)}
                  data-testid={`compass-order-remove-${row.priority}`}
                  title="Take this compass out of the order"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {model.extras.length > 0 ? (
        <p className="bf-note" data-testid="compass-order-extra">
          Also found, with no slot left:{' '}
          {model.extras.map((device) => `${device.sensor} (${device.location})`).join(', ')}. Remove one above to make
          room, then reboot.
        </p>
      ) : null}

    </div>
  )
}
