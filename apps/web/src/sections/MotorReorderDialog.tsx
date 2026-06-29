// Motor Setup popout — the Reorder (which output drives each motor number)
// and Direction (per-motor spin + DShot reverse toggles) workbench, with the
// shared props-off / test-area safety acks pinned at the top.
//
// Extracted verbatim from App.tsx as part of the decomposition. Purely
// presentational: all motor-management state (selections, guided-identify
// progress, reorder rows) and the spin/stage/guided handlers are passed in;
// the FC-spinning intent lives in App.tsx. Gated by motorReorderDialogOpen at
// the call site, so this renders unconditionally. Behavior-preserving.

import type { ReactElement } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'
import type { ConfiguratorSnapshot, ServoOutputAssignment } from '@arduconfig/ardupilot-core'

import { normalizeBitmaskValue } from '../parameter-format'
import { hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import type { MotorPreviewNode } from '../view-models/motor-preview'
import { motorSpinArcPath } from '../views/motor-spin-arc'
import type { MotorReorderRow } from '../hooks/use-motor-reorder'

export interface MotorReorderDialogProps {
  snapshot: ConfiguratorSnapshot
  airframe: { frameClassLabel: string; frameTypeLabel: string }
  busyAction: string | undefined
  editedValues: Record<string, string>

  motorDialogTab: 'reorder' | 'direction'
  motorDialogSpinError: string | undefined
  propsRemovedAcknowledged: boolean
  testAreaAcknowledged: boolean

  motorPreviewNodes: MotorPreviewNode[]
  motorPreviewGeometryMode: string
  effectiveMotorOutputs: ServoOutputAssignment[]
  motorReorderRows: MotorReorderRow[]
  motorReorderSelections: Record<string, string>
  motorReorderDuplicateChannels: number[]
  motorReorderCanStage: boolean
  motorReorderChangedCount: number

  guidedReorderActive: boolean
  guidedReorderStep: number
  guidedReorderMapping: Record<string, number>
  /** Operator-paced identify: true while waiting for the explicit Spin
   *  click (no auto-spin — it raced the FC's previous test window). */
  guidedReorderAwaitingSpin: boolean
  /** True once an identify sequence finished this dialog session. Gates
   *  the Stage button's primary emphasis and the no-changes note. */
  guidedReorderCompleted: boolean

  onClose: () => void
  onTabChange: (tab: 'reorder' | 'direction') => void
  onPropsRemovedChange: (value: boolean) => void
  onTestAreaChange: (value: boolean) => void
  onSelectionChange: (motorNumber: number, value: string) => void
  onStartGuidedReorder: () => void
  onCancelGuidedReorder: () => void
  onSpinGuidedReorderCurrent: () => void
  onPickGuidedReorderPosition: (motorNumber: number) => void
  onStageReorderDrafts: () => void
  onSpinSingleMotor: (channelNumber: number) => void
  setDraft: (paramId: string, value: string) => void

  /** Count of staged motor drafts (reorder + reverse mask) this dialog can
   *  write in place, so Apply can be enabled/labelled without closing. */
  motorReorderStagedCount: number
  /** Whether parameter writes are currently allowed (connected, synced,
   *  disarmed). The Apply handler re-checks and surfaces its own notice. */
  canApplyMotorDrafts: boolean
  /** True once an applied change needs a reboot to take effect — emphasises
   *  the Reboot button and shows the inline prompt. */
  rebootRecommended: boolean
  /** Write the staged motor drafts AND reboot the FC afterwards so the new
   *  output map / reverse mask takes effect — one operator action. */
  onApplyAndRebootMotorDrafts: () => void
  /** Render inline (no lightbox backdrop / Close) for embedding directly in the
   *  Motor Setup tab instead of as a popout. */
  inline?: boolean
}

export function MotorReorderDialog({
  snapshot,
  airframe,
  busyAction,
  editedValues,
  motorDialogTab,
  motorDialogSpinError,
  propsRemovedAcknowledged,
  testAreaAcknowledged,
  motorPreviewNodes,
  motorPreviewGeometryMode,
  effectiveMotorOutputs,
  motorReorderRows,
  motorReorderSelections,
  motorReorderDuplicateChannels,
  motorReorderCanStage,
  motorReorderChangedCount,
  guidedReorderActive,
  guidedReorderStep,
  guidedReorderMapping,
  guidedReorderAwaitingSpin,
  guidedReorderCompleted,
  onClose,
  onTabChange,
  onPropsRemovedChange,
  onTestAreaChange,
  onSelectionChange,
  onStartGuidedReorder,
  onCancelGuidedReorder,
  onSpinGuidedReorderCurrent,
  onPickGuidedReorderPosition,
  onStageReorderDrafts,
  onSpinSingleMotor,
  setDraft,
  motorReorderStagedCount,
  canApplyMotorDrafts,
  rebootRecommended,
  onApplyAndRebootMotorDrafts,
  inline = false
}: MotorReorderDialogProps): ReactElement {
  const motorTestBusy =
    snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'
  // While an Apply-and-reboot is in flight (link dropping/reconnecting) or the
  // params are re-syncing afterwards, show a single calm status line instead of
  // the live reorder UI churning through the reload.
  const rebootStatus =
    busyAction === 'reboot-autopilot' || snapshot.connection.kind !== 'connected'
      ? 'Rebooting…'
      : snapshot.parameterStats.status !== 'complete'
        ? 'Params refreshing…'
        : undefined
  const body = (
    <>
        {!inline ? (
          <div className="board-media-lightbox__header">
            <div>
              <strong>Motor Setup</strong>
              <p>Two steps: <strong>1 · Order</strong> — confirm each output drives the right position. <strong>2 · Direction</strong> — confirm each motor spins the right way. Nothing is written until you Apply.</p>
            </div>
            <button type="button" style={buttonStyle()} onClick={onClose}>
              Close
            </button>
          </div>
        ) : null}

        {rebootStatus ? (
          <p className="motor-reorder-status" role="status" data-testid="motor-reorder-status">{rebootStatus}</p>
        ) : (
          <>
        {/* Safety acknowledgments — pinned at the top of the dialog so
         *  the operator can't miss the props-off ack and doesn't have
         *  to leave the popout to set it. Required for both the
         *  Reorder identify and the Direction spin to enable. */}
        <div className="motor-reorder-lightbox__acks" data-testid="motor-reorder-lightbox-acks">
          {/* One combined safety ack — props off AND the craft restrained/clear
           *  — driving both underlying acknowledgments together. */}
          <label
            className={`motor-test-acknowledgments__props-off${propsRemovedAcknowledged && testAreaAcknowledged ? ' is-acknowledged' : ''}`}
            data-testid="motor-reorder-props-off-ack"
          >
            <input
              type="checkbox"
              checked={propsRemovedAcknowledged && testAreaAcknowledged}
              onChange={(event) => {
                onPropsRemovedChange(event.target.checked)
                onTestAreaChange(event.target.checked)
              }}
              disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
            />
            <span>Props are off and the vehicle is restrained with the test area clear.</span>
          </label>
        </div>

        {/* BF-style tabs: Reorder | Direction. Reorder still spins
         *  motors during guided-identify (the same MOTOR_TEST command
         *  with a 6%/2.5s window); Direction tab gives the operator
         *  per-motor spin buttons plus the SERVO_BLH_RVMASK reverse
         *  toggles for DShot ESCs in one place. */}
        <div className="motor-reorder-lightbox__tabs" role="tablist" data-testid="motor-reorder-lightbox-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={motorDialogTab === 'reorder'}
            className={`motor-reorder-lightbox__tab${motorDialogTab === 'reorder' ? ' is-active' : ''}`}
            onClick={() => onTabChange('reorder')}
            data-testid="motor-reorder-lightbox-tab-reorder"
          >
            1 · Order
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={motorDialogTab === 'direction'}
            className={`motor-reorder-lightbox__tab${motorDialogTab === 'direction' ? ' is-active' : ''}`}
            onClick={() => onTabChange('direction')}
            data-testid="motor-reorder-lightbox-tab-direction"
          >
            2 · Direction
          </button>
        </div>

        {motorDialogSpinError ? (
          <div className="bf-note bf-note--warning" data-testid="motor-reorder-spin-error">
            <p><strong>Motor test failed.</strong> {motorDialogSpinError}</p>
          </div>
        ) : null}

        {motorDialogTab === 'reorder' ? (
        <div className="motor-reorder-lightbox__grid">
          <section className="bf-gui-box">
            <div className="bf-gui-box__titlebar">
              <strong>Preview</strong>
            </div>
            <div className="bf-gui-box__body">
              {motorPreviewNodes.length > 0 ? (
                <div className="motor-mixer-preview motor-mixer-preview--dialog">
                  <svg viewBox="0 0 260 260" role="img" aria-label="Schematic reordered motor map preview">
                    <defs>
                      <marker id="spinArrowReorder" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                        <path d="M 0 0 L 6 3 L 0 6 z" className="motor-mixer-preview__spin-head" />
                      </marker>
                    </defs>
                    <rect x="0" y="0" width="260" height="260" rx="18" className="motor-mixer-preview__backdrop" />
                    <line x1="130" y1="34" x2="130" y2="58" className="motor-mixer-preview__nose-arrow" />
                    <polygon points="130,18 122,36 138,36" className="motor-mixer-preview__nose-arrow" />
                    {motorPreviewNodes.map((node) => {
                      const selectedChannelNumber = Number(motorReorderSelections[String(node.motorNumber)] ?? '')
                      const selectedOutput = effectiveMotorOutputs.find((output) => output.channelNumber === selectedChannelNumber)
                      const x = 130 + node.x * 82
                      const y = 130 + node.y * 82
                      // During guided identify each position is clickable
                      // ONCE: a position already claimed by an earlier
                      // output is locked, so a second click can't overwrite
                      // a prior pick and silently drop a motor (safety —
                      // the reorder must stay a clean permutation).
                      const alreadyPicked = guidedReorderActive
                        ? Object.values(guidedReorderMapping).includes(node.motorNumber)
                        : false
                      const pickable = guidedReorderActive && !alreadyPicked

                      return (
                        <g
                          key={`motor-dialog-preview:${node.motorNumber}`}
                          className={`motor-mixer-preview__node ${selectedOutput ? 'is-mapped' : 'is-empty'}${pickable ? ' is-pickable' : ''}${alreadyPicked ? ' is-picked' : ''}`}
                          onClick={pickable ? () => onPickGuidedReorderPosition(node.motorNumber) : undefined}
                          style={pickable ? { cursor: 'pointer' } : undefined}
                          data-testid={pickable ? `motor-reorder-pick-${node.motorNumber}` : undefined}
                        >
                          <line x1="130" y1="130" x2={x} y2={y} className="motor-mixer-preview__arm" />
                          <circle cx={x} cy={y} r={node.stack ? 29 : 24} className="motor-mixer-preview__ring" />
                          {node.stack ? <circle cx={x} cy={y} r={19} className="motor-mixer-preview__stack" /> : null}
                          {node.spin ? (
                            <path
                              d={motorSpinArcPath(x, y, (node.stack ? 29 : 24) + 6, node.spin)}
                              className="motor-mixer-preview__spin"
                              markerEnd="url(#spinArrowReorder)"
                            />
                          ) : null}
                          <text x={x} y={y + 4} textAnchor="middle" className="motor-mixer-preview__motor-number">
                            {node.motorNumber}
                          </text>
                          <text x={x} y={y + (node.stack ? 38 : 34)} textAnchor="middle" className="motor-mixer-preview__channel-label">
                            {selectedOutput ? `OUT${selectedOutput.channelNumber}` : 'UNMAPPED'}
                          </text>
                        </g>
                      )
                    })}
                    <circle cx="130" cy="130" r="26" className="motor-mixer-preview__body" />
                    <text x="130" y="136" textAnchor="middle" className="motor-mixer-preview__center-label">
                      {motorPreviewGeometryMode.toUpperCase()}
                    </text>
                  </svg>
                </div>
              ) : (
                <div className="bf-note">
                  <p>No mapped motor outputs are available to reorder yet.</p>
                </div>
              )}

              <div className="config-pills">
                <span>{airframe.frameClassLabel}</span>
                <span>{airframe.frameTypeLabel}</span>
                <span>{motorReorderRows.length} mapped outputs</span>
              </div>
            </div>
          </section>

          <section className="bf-gui-box">
            <div className="bf-gui-box__titlebar">
              <strong>Assignments</strong>
            </div>
            <div className="bf-gui-box__body">
              {guidedReorderActive ? (
                <div className="bf-note bf-note--accent" data-testid="motor-reorder-guided-banner">
                  <p>
                    {guidedReorderAwaitingSpin ? (
                      <>
                        <strong>OUT{effectiveMotorOutputs[guidedReorderStep]?.channelNumber ?? '?'}</strong>
                        {' '}({guidedReorderStep + 1} / {effectiveMotorOutputs.length}) — click Spin when ready.
                      </>
                    ) : (
                      <>
                        <strong>OUT{effectiveMotorOutputs[guidedReorderStep]?.channelNumber ?? '?'} spun</strong>
                        {' '}({guidedReorderStep + 1} / {effectiveMotorOutputs.length}). Click the position that moved, or Spin again.
                      </>
                    )}
                  </p>
                  <div className="switch-exercise-controls">
                    <button
                      type="button"
                      style={buttonStyle('primary')}
                      onClick={onSpinGuidedReorderCurrent}
                      disabled={busyAction !== undefined || motorTestBusy}
                      data-testid="motor-reorder-guided-spin"
                    >
                      {motorTestBusy ? 'Spinning…' : guidedReorderAwaitingSpin ? 'Spin' : 'Spin again'}
                    </button>
                    <button
                      type="button"
                      style={buttonStyle()}
                      onClick={onCancelGuidedReorder}
                      data-testid="motor-reorder-guided-cancel"
                    >
                      Cancel identify
                    </button>
                  </div>
                </div>
              ) : (
                <div className="switch-exercise-controls" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    style={buttonStyle('primary')}
                    onClick={onStartGuidedReorder}
                    disabled={
                      effectiveMotorOutputs.length === 0 ||
                      !propsRemovedAcknowledged ||
                      !testAreaAcknowledged ||
                      snapshot.connection.kind !== 'connected' ||
                      busyAction !== undefined
                    }
                    data-testid="motor-reorder-guided-start"
                  >
                    Identify motors interactively
                  </button>
                </div>
              )}
              <details className="motor-reorder-manual" data-testid="motor-reorder-manual">
                <summary>Manual output mapping (optional)</summary>
                <p className="motor-reorder-manual__hint">
                  Prefer “Identify motors interactively” above. Use this only if you already know each motor’s output.
                </p>
                <div className="motor-reorder-table">
                <div className="motor-reorder-table__row motor-reorder-table__row--header">
                  <span>Motor</span>
                  <span>Current</span>
                  <span>Target Output</span>
                </div>
                {motorReorderRows.map((row) => (
                  <label key={`motor-reorder-row:${row.motorNumber}`} className="motor-reorder-table__row">
                    <strong>M{row.motorNumber}</strong>
                    <span>{row.currentOutputLabel}</span>
                    <select
                      value={motorReorderSelections[String(row.motorNumber)] ?? String(row.currentChannelNumber)}
                      onChange={(event) => onSelectionChange(row.motorNumber, event.target.value)}
                    >
                      {effectiveMotorOutputs.map((output) => (
                        <option key={`motor-reorder-option:${row.motorNumber}:${output.channelNumber}`} value={String(output.channelNumber)}>
                          OUT{output.channelNumber} · {output.functionLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              </details>

              {motorReorderDuplicateChannels.length > 0 ? (
                <div className="bf-note bf-note--warning">
                  <p>Each motor must use a unique output. Resolve the duplicate selections on {motorReorderDuplicateChannels.map((channelNumber) => `OUT${channelNumber}`).join(', ')}.</p>
                </div>
              ) : null}

              <ul className="output-note-list">
                <li>This changes which output pin carries each motor function. It does not infer or change ESC spin direction.</li>
                <li>After applying a new order, rerun the guarded direction check and confirm the correct motor spins.</li>
              </ul>

              {guidedReorderCompleted && motorReorderChangedCount === 0 ? (
                <div className="bf-note" data-testid="motor-reorder-no-changes">
                  <p>Motor order already matches — no changes needed.</p>
                </div>
              ) : null}

              <div className="switch-exercise-controls">
                <button type="button" style={buttonStyle()} onClick={onClose}>
                  Cancel
                </button>
                {/* Primary emphasis only after an identify run has produced
                 *  something to stage — an untested green button read as
                 *  "click me" before any motor had ever spun. */}
                <button
                  type="button"
                  style={buttonStyle(guidedReorderCompleted && motorReorderChangedCount > 0 ? 'primary' : undefined)}
                  onClick={onStageReorderDrafts}
                  disabled={!motorReorderCanStage}
                >
                  {motorReorderChangedCount > 0 ? `Stage Reorder (${motorReorderChangedCount})` : 'Stage Reorder'}
                </button>
              </div>
            </div>
          </section>
        </div>
        ) : null}

        {/* Direction tab — per-motor spin buttons and the
         *  SERVO_BLH_RVMASK reverse toggles, all inside the same
         *  popout. Same safety acks gate spin as the Reorder tab. */}
        {motorDialogTab === 'direction' ? (
        <div className="motor-reorder-lightbox__direction" data-testid="motor-reorder-lightbox-direction">
          <section className="bf-gui-box">
            <div className="bf-gui-box__titlebar">
              <strong>Spin individual motors</strong>
            </div>
            <div className="bf-gui-box__body">
              <p className="bf-note">
                Click a motor on the schematic to spin it (~2.5 s at 6%). Arrows show the correct prop
                direction (top view). Wrong way? Flip its Reverse toggle below (DShot only).
              </p>
              {motorPreviewNodes.length > 0 ? (
                <div className="motor-mixer-preview motor-mixer-preview--dialog">
                  <svg viewBox="0 0 260 260" role="img" aria-label="Clickable motor map — click a motor to spin it">
                    <defs>
                      <marker id="spinArrowDirection" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                        <path d="M 0 0 L 6 3 L 0 6 z" className="motor-mixer-preview__spin-head" />
                      </marker>
                    </defs>
                    <rect x="0" y="0" width="260" height="260" rx="18" className="motor-mixer-preview__backdrop" />
                    <line x1="130" y1="34" x2="130" y2="58" className="motor-mixer-preview__nose-arrow" />
                    <polygon points="130,18 122,36 138,36" className="motor-mixer-preview__nose-arrow" />
                    {motorPreviewNodes.map((node) => {
                      const output = effectiveMotorOutputs.find(
                        (candidate) => candidate.motorNumber === node.motorNumber
                      )
                      const x = 130 + node.x * 82
                      const y = 130 + node.y * 82
                      const spinnable =
                        output !== undefined &&
                        propsRemovedAcknowledged &&
                        testAreaAcknowledged &&
                        snapshot.connection.kind === 'connected' &&
                        busyAction === undefined &&
                        !motorTestBusy
                      return (
                        <g
                          key={`motor-direction-node:${node.motorNumber}`}
                          className={`motor-mixer-preview__node ${output ? 'is-mapped' : 'is-empty'}${spinnable ? ' is-pickable' : ''}`}
                          onClick={spinnable ? () => onSpinSingleMotor(output.channelNumber) : undefined}
                          style={spinnable ? { cursor: 'pointer' } : undefined}
                          data-testid={`motor-direction-spin-${node.motorNumber}`}
                        >
                          <line x1="130" y1="130" x2={x} y2={y} className="motor-mixer-preview__arm" />
                          <circle cx={x} cy={y} r={node.stack ? 29 : 24} className="motor-mixer-preview__ring" />
                          {node.stack ? <circle cx={x} cy={y} r={19} className="motor-mixer-preview__stack" /> : null}
                          {node.spin ? (
                            <path
                              d={motorSpinArcPath(x, y, (node.stack ? 29 : 24) + 6, node.spin)}
                              className="motor-mixer-preview__spin"
                              markerEnd="url(#spinArrowDirection)"
                            />
                          ) : null}
                          <text x={x} y={y + 4} textAnchor="middle" className="motor-mixer-preview__motor-number">
                            {node.motorNumber}
                          </text>
                          <text x={x} y={y + (node.stack ? 38 : 34)} textAnchor="middle" className="motor-mixer-preview__channel-label">
                            {output ? `OUT${output.channelNumber}` : 'UNMAPPED'}
                          </text>
                        </g>
                      )
                    })}
                    <circle cx="130" cy="130" r="26" className="motor-mixer-preview__body" />
                    <text x="130" y="136" textAnchor="middle" className="motor-mixer-preview__center-label">
                      {motorPreviewGeometryMode.toUpperCase()}
                    </text>
                  </svg>
                </div>
              ) : (
                <p className="bf-note">No mapped motor outputs are available to spin yet.</p>
              )}
              {(() => {
                const rvmaskParam = selectParameterById(snapshot, 'SERVO_BLH_RVMASK')
                if (!rvmaskParam || effectiveMotorOutputs.length === 0) {
                  return (
                    <p className="bf-note">
                      Reverse toggles require a DShot ESC protocol and SERVO_BLH_RVMASK metadata. Set MOT_PWM_TYPE to a DShot value (4-7) first.
                    </p>
                  )
                }
                const currentMask = normalizeBitmaskValue(editedValues[rvmaskParam.id], rvmaskParam.value)
                const motPwmType = Math.round(
                  Number(editedValues.MOT_PWM_TYPE ?? readRoundedParameter(snapshot, 'MOT_PWM_TYPE') ?? 0)
                )
                const isDShot = motPwmType >= 4 && motPwmType <= 7
                return (
                  <div className="motor-reverse-card" data-testid="motor-reorder-direction-reverse">
                    <div className="switch-exercise-card__header">
                      <div>
                        <strong>Reverse motor direction</strong>
                        <p>
                          If the right motor spins the wrong way, reverse it here over DShot (BLHeli/AM32) instead
                          of swapping wires. {isDShot ? 'Takes effect on the next reboot/redetect.' : 'Requires a DShot ESC protocol — set MOT_PWM_TYPE to a DShot value (4-7) first.'}
                        </p>
                      </div>
                    </div>
                    <div className="motor-reverse-grid">
                      {effectiveMotorOutputs.map((output) => {
                        const bit = output.channelNumber - 1
                        const reversed = hasBitmaskFlag(currentMask, bit)
                        return (
                          <label
                            key={`motor-reorder-direction-reverse:${output.paramId}`}
                            className="motor-reverse-toggle"
                            data-testid={`motor-reorder-direction-reverse-${output.channelNumber}`}
                          >
                            <input
                              type="checkbox"
                              checked={reversed}
                              disabled={!isDShot || busyAction !== undefined}
                              onChange={(event) =>
                                setDraft(rvmaskParam.id, String(toggleBitmaskFlag(currentMask, bit, event.target.checked)))
                              }
                            />
                            <span>
                              M{output.motorNumber ?? '?'} · OUT{output.channelNumber}
                              {reversed ? ' — reversed' : ''}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          </section>
        </div>
        ) : null}

        {/* Shared action bar — Apply writes the staged reorder / reverse
         *  drafts to the FC without closing the dialog, and Reboot lets the
         *  operator restart the controller so reboot-sensitive changes (e.g.
         *  reverse mask) take effect, all in one place. */}
        <div className="motor-reorder-lightbox__apply-bar" data-testid="motor-reorder-apply-bar">
          <small>
            {motorReorderStagedCount > 0
              ? `${motorReorderStagedCount} staged change${motorReorderStagedCount === 1 ? '' : 's'} ready to write to the flight controller.`
              : 'Stage a reorder or flip a reverse toggle, then apply — no need to leave this dialog.'}
          </small>
          <div className="switch-exercise-controls">
            <button
              type="button"
              style={buttonStyle(motorReorderStagedCount > 0 ? 'primary' : undefined)}
              onClick={onApplyAndRebootMotorDrafts}
              disabled={motorReorderStagedCount === 0 || !canApplyMotorDrafts || busyAction !== undefined}
              data-testid="motor-reorder-apply"
            >
              {busyAction === 'motor-reorder:apply'
                ? 'Writing…'
                : busyAction === 'reboot-autopilot'
                  ? 'Rebooting…'
                  : motorReorderStagedCount > 0
                    ? `Apply and reboot (${motorReorderStagedCount})`
                    : 'Apply and reboot'}
            </button>
          </div>
          {rebootRecommended ? (
            <small className="motor-reorder-lightbox__reboot-note" data-testid="motor-reorder-reboot-note">
              A change you applied needs a reboot to take effect. Reboot the flight controller, then re-check direction.
            </small>
          ) : null}
        </div>
          </>
        )}
    </>
  )

  if (inline) {
    return <div className="motor-reorder-inline">{body}</div>
  }

  return (
    <div className="board-media-lightbox motor-reorder-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="board-media-lightbox__frame motor-reorder-lightbox__frame" onClick={(event) => event.stopPropagation()}>
        {body}
      </div>
    </div>
  )
}
