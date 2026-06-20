import type { ParameterState, ServoOutputAssignment } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { ScopedField, ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'

// Per-channel servo function mapping. Each row owns one SERVOn_FUNCTION
// parameter plus its SERVOn_MIN / MAX / TRIM / REVERSED siblings — the
// firmware writes via the GCS once the user applies the staged changes.
// The view stays read-aware: assignments come from the live snapshot
// via deriveServoOutputAssignments(), so SERVO channels the FC doesn't
// expose (e.g. an 8-output board) simply don't appear.
//
// Live SERVO_OUTPUT_RAW PWM column is still a follow-up — this slice
// shipped editable PWM range/trim/reverse for full Mission Planner
// "Servo Output" parity.

export interface ServoFunctionMappingRow {
  /** SERVOn_FUNCTION parameter, when the FC exposes the channel. */
  parameter: ParameterState
  assignment: ServoOutputAssignment
  /** Tone derived from the assignment kind so the user can scan motor
   *  vs aux vs disabled rows at a glance. */
  tone: 'success' | 'warning' | 'neutral' | 'danger'
  toneLabel: string
  /** PWM range editors. Optional because a board may report fewer
   *  channels than the catalog defines — the row still renders the
   *  function dropdown but the matching MIN/MAX/TRIM/REVERSED cells
   *  fall back to "—". */
  minParameter?: ParameterState
  maxParameter?: ParameterState
  trimParameter?: ParameterState
  reversedParameter?: ParameterState
}

export interface ServoFunctionMappingViewProps {
  rows: readonly ServoFunctionMappingRow[]
  editedValues: Record<string, string>
  onEditChange: (paramId: string, value: string) => void
  draftStatusById: ScopedFieldDraftMap
  stagedCount: number
  invalidCount: number
  draftCount: number
  canApply: boolean
  isApplying: boolean
  isBusy: boolean
  onApply: () => void
  onRevert: () => void
}

function reversedIsChecked(reversed: ParameterState | undefined, editedValues: Record<string, string>): boolean {
  if (!reversed) return false
  const edited = editedValues[reversed.id]
  if (edited !== undefined && edited !== '') {
    return Number.parseInt(edited, 10) === 1
  }
  return Math.round(reversed.value ?? 0) === 1
}

export function ServoFunctionMappingView(props: ServoFunctionMappingViewProps) {
  const {
    rows,
    editedValues,
    onEditChange,
    draftStatusById,
    stagedCount,
    invalidCount,
    draftCount,
    canApply,
    isApplying,
    isBusy,
    onApply,
    onRevert
  } = props

  const motorCount = rows.filter((row) => row.assignment.kind === 'motor').length
  const auxCount = rows.filter((row) => row.assignment.kind !== 'motor' && row.assignment.kind !== 'unused').length
  const disabledCount = rows.filter((row) => row.assignment.kind === 'unused').length

  return (
    <Panel
      title="Servo function mapping"
      subtitle={`Assign a function to each output channel and dial the PWM range, trim, and direction. ${motorCount} motor · ${auxCount} aux · ${disabledCount} unused.`}
    >
      <div className="servo-mapping">
        {rows.length === 0 ? (
          <p className="servo-mapping__empty">
            No SERVOn_FUNCTION parameters reported by the autopilot yet. Connect, pull parameters, and the channel
            table will populate.
          </p>
        ) : (
          <table className="servo-mapping__table" data-testid="servo-mapping-table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Function</th>
                <th scope="col">Min</th>
                <th scope="col">Trim</th>
                <th scope="col">Max</th>
                <th scope="col">Rev</th>
                <th scope="col">Kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const channel = row.assignment.channelNumber
                const reversedParam = row.reversedParameter
                return (
                  <tr
                    key={row.parameter.id}
                    className={`servo-mapping__row servo-mapping__row--${row.assignment.kind}`}
                    data-testid={`servo-mapping-row-${channel}`}
                  >
                    <th scope="row" className="servo-mapping__channel">
                      <strong>SERVO{channel}</strong>
                      <small>{row.parameter.id}</small>
                    </th>
                    <td className="servo-mapping__function">
                      <ScopedSelectField
                        parameter={row.parameter}
                        liveValue={row.assignment.functionValue}
                        editedValues={editedValues}
                        onChange={onEditChange}
                        draftStatusById={draftStatusById}
                      />
                    </td>
                    <td className="servo-mapping__pwm">
                      {row.minParameter ? (
                        <ScopedField
                          parameter={row.minParameter}
                          liveValue={row.minParameter.value}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                          stepFallback={10}
                        />
                      ) : <span className="servo-mapping__missing">—</span>}
                    </td>
                    <td className="servo-mapping__pwm">
                      {row.trimParameter ? (
                        <ScopedField
                          parameter={row.trimParameter}
                          liveValue={row.trimParameter.value}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                          stepFallback={10}
                        />
                      ) : <span className="servo-mapping__missing">—</span>}
                    </td>
                    <td className="servo-mapping__pwm">
                      {row.maxParameter ? (
                        <ScopedField
                          parameter={row.maxParameter}
                          liveValue={row.maxParameter.value}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                          stepFallback={10}
                        />
                      ) : <span className="servo-mapping__missing">—</span>}
                    </td>
                    <td className="servo-mapping__rev">
                      {reversedParam ? (
                        <label className="servo-mapping__rev-toggle" data-testid={`servo-mapping-reversed-${channel}`}>
                          <input
                            type="checkbox"
                            checked={reversedIsChecked(reversedParam, editedValues)}
                            onChange={(event) => onEditChange(reversedParam.id, event.target.checked ? '1' : '0')}
                          />
                          <span>{reversedIsChecked(reversedParam, editedValues) ? 'On' : 'Off'}</span>
                        </label>
                      ) : <span className="servo-mapping__missing">—</span>}
                    </td>
                    <td className="servo-mapping__kind">
                      <StatusBadge tone={row.tone}>{row.toneLabel}</StatusBadge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="servo-mapping__toolbar">
          <div className="servo-mapping__toolbar-status">
            <span>{stagedCount} staged</span>
            <span>{invalidCount} invalid</span>
          </div>
          <button
            type="button"
            style={buttonStyle('primary')}
            onClick={onApply}
            disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            data-testid="servo-mapping-apply"
          >
            {isApplying ? 'Applying…' : `Apply servo mapping (${stagedCount})`}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            onClick={onRevert}
            disabled={isBusy || draftCount === 0}
            data-testid="servo-mapping-revert"
          >
            Revert
          </button>
        </div>
      </div>
    </Panel>
  )
}
