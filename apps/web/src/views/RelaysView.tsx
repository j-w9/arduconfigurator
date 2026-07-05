import { Panel, buttonStyle } from '@arduconfig/ui-kit'

import type { RelayInstanceGroup } from '../view-models/relay-groups'
import {
  planRelayRcChannelChange,
  relayRcChannelBinding,
  RELAY_RC_CHANNEL_COUNT
} from '../view-models/relay-groups'
import { ScopedField, ScopedSelectField, type ScopedFieldDraftMap } from './ScopedField'

// Relays tab — AP_Relay RELAYx_FUNCTION/PIN/DEFAULT/INVERTED, one card per
// reported relay instance. Dumb presentational surface: App builds the groups
// (buildRelayGroups) and owns the edited-value map + apply/discard handlers.
// FUNCTION/DEFAULT/INVERTED are enums (small ones render as chips); PIN is the
// digital GPIO number. Edits flow through the same staged-draft + Apply pattern
// as the other Outputs surfaces.

export interface RelaysViewProps {
  groups: readonly RelayInstanceGroup[]
  /** Live RCn_OPTION value per channel (1..16), for the RC-toggle binding. */
  rcOptionByChannel: ReadonlyMap<number, number>
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

export function RelaysView(props: RelaysViewProps) {
  const {
    groups,
    rcOptionByChannel,
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

  return (
    <Panel
      title="Relays"
      subtitle="Map flight-controller GPIO pins to relay functions — parachute, camera, ICE, or a plain operator-controlled relay — and set each relay's default state and signal polarity."
    >
      <div className="relays-tab" data-testid="relays-task-body">
        {groups.length === 0 ? (
          <p className="bf-note" data-testid="relays-empty">
            No RELAYx_* parameters reported by the autopilot yet. Connect, pull parameters, and the relay cards will
            populate.
          </p>
        ) : (
          <div className="relays-tab__grid">
            {groups.map((group) => (
              <section
                key={group.instance}
                className="scoped-review-card scoped-review-card--compact"
                data-testid={`relay-card-${group.instance}`}
              >
                <div className="switch-exercise-card__header">
                  <div>
                    <strong>{group.label}</strong>
                  </div>
                </div>
                <div className="scoped-editor-grid">
                  {group.parameters.map((parameter) => {
                    const hasOptions = (parameter.definition?.options ?? []).length > 0
                    return hasOptions ? (
                      <ScopedSelectField
                        key={parameter.id}
                        parameter={parameter}
                        liveValue={parameter.value}
                        editedValues={editedValues}
                        onChange={onEditChange}
                        draftStatusById={draftStatusById}
                        layout="chips"
                      />
                    ) : (
                      <ScopedField
                        key={parameter.id}
                        parameter={parameter}
                        liveValue={parameter.value}
                        editedValues={editedValues}
                        onChange={onEditChange}
                        draftStatusById={draftStatusById}
                      />
                    )
                  })}
                </div>
                {group.auxFunc !== undefined
                  ? (() => {
                      // Effective RCn_OPTION per channel: staged edit over live value.
                      const effective = new Map<number, number>()
                      for (let channel = 1; channel <= RELAY_RC_CHANNEL_COUNT; channel += 1) {
                        const edited = editedValues[`RC${channel}_OPTION`]
                        const raw =
                          edited !== undefined && edited !== '' ? Number(edited) : rcOptionByChannel.get(channel) ?? 0
                        effective.set(channel, Number.isFinite(raw) ? raw : 0)
                      }
                      const bound = relayRcChannelBinding(group.auxFunc, effective)
                      const liveBound = relayRcChannelBinding(group.auxFunc, rcOptionByChannel)
                      const staged = bound !== liveBound
                      return (
                        <div
                          className={`relay-rc-channel${staged ? ' relay-rc-channel--staged' : ''}`}
                          data-testid={`relay-rc-channel-${group.instance}`}
                        >
                          <label className="scoped-editor-field">
                            <span>RC Channel</span>
                            <select
                              value={String(bound ?? 0)}
                              onChange={(event) => {
                                const next = Number(event.target.value)
                                for (const write of planRelayRcChannelChange(group.auxFunc!, next, bound)) {
                                  onEditChange(write.id, write.value)
                                }
                              }}
                            >
                              <option value="0">None</option>
                              {Array.from({ length: RELAY_RC_CHANNEL_COUNT }, (_, i) => i + 1).map((channel) => (
                                <option key={channel} value={String(channel)}>
                                  Ch {channel}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="relay-rc-channel__hint">
                            {bound
                              ? `RC${bound} toggles ${group.label} — sets RC${bound}_OPTION = ${group.auxFunc}.`
                              : 'Pick an RC switch channel to toggle this relay from your transmitter.'}
                          </p>
                        </div>
                      )
                    })()
                  : null}
              </section>
            ))}
          </div>
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
            data-testid="relays-apply"
          >
            {isApplying ? 'Applying…' : `Apply relay changes (${stagedCount})`}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            onClick={onRevert}
            disabled={isBusy || draftCount === 0}
            data-testid="relays-revert"
          >
            Revert
          </button>
        </div>
      </div>
    </Panel>
  )
}
