import type { ReactNode } from 'react'

import type { ParameterState } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { ScopedField, ScopedSelectField, ScopedBitmaskField, type ScopedFieldDraftMap } from './ScopedField'

// BF-style "Configuration" catch-all surface. Mission Planner and BF
// both collect a grab-bag of baseline knobs here: board orientation,
// arming behavior, identity, beeper, statistics. None of these warrant
// their own tab on their own, but together they're the "everything
// else" surface operators expect after the main workflow tabs.
//
// Editable fields surface through the shared scoped editors so they
// pick up the staged-red + "was X" treatment automatically. Statistics
// stays read-only — those are lifetime counters reported by the FC,
// not configuration knobs the operator can change.

export interface ConfigSectionField {
  /** Parameter id to read from the snapshot. */
  paramId: string
  /** Short label for read-only rows + the missing-row placeholder.
   *  Editable fields prefer the catalog label when available. */
  label: string
  /** Optional unit suffix for read-only display values. */
  unit?: string
  /** Decimal places for read-only float values. Editable fields go
   *  through the shared float formatter from param-metadata. */
  digits?: number
}

export interface ConfigSection {
  id: string
  title: string
  description: string
  fields: readonly ConfigSectionField[]
  /** True = read-only data list (used for STAT_* counters). */
  readOnly?: boolean
  /** True = the section is a placeholder; render a "planned" badge
   *  in place of the field grid. */
  planned?: boolean
  /** Optional node rendered below the field grid — used for one-click
   *  helpers (e.g. the ESC section's "enable bidirectional DShot" button)
   *  and contextual warnings the generic field editors can't express. */
  footer?: ReactNode
}

export interface ConfigViewProps {
  sections: readonly ConfigSection[]
  parametersById: ReadonlyMap<string, ParameterState>
  // -------- editable-state plumbing (mirrors the OSD tab) ----------
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

function formatReadOnlyValue(
  parameter: ParameterState | undefined,
  field: ConfigSectionField
): string {
  if (!parameter) return '—'
  const raw = parameter.value
  if (raw === undefined || !Number.isFinite(raw)) return '—'
  const digits = field.digits ?? (Number.isInteger(raw) ? 0 : 2)
  const text = raw.toFixed(digits)
  return field.unit ? `${text} ${field.unit}` : text
}

export function ConfigView(props: ConfigViewProps) {
  const {
    sections,
    parametersById,
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
    <div id="setup-panel-config">
      <Panel
        title="Config"
        subtitle="Board orientation, arming, system identity, beeper, statistics."
      >
        <div className="config-grid" data-testid="config-section-grid">
          {sections.map((section) => (
            <article
              key={section.id}
              className={`config-section${section.planned ? ' config-section--planned' : ''}${section.readOnly ? ' config-section--readonly' : ''}`}
              data-testid={`config-section-${section.id}`}
            >
              <header className="config-section__header">
                <div>
                  <strong>{section.title}</strong>
                  {/* Per-section blurb dropped in the cleanup — the per-param "i"
                      tooltips carry the detail now; the title names the group. */}
                </div>
                {section.planned ? (
                  <StatusBadge tone="warning">planned</StatusBadge>
                ) : section.readOnly ? (
                  <StatusBadge tone="neutral">read-only</StatusBadge>
                ) : null}
              </header>

              {section.planned ? null : section.readOnly ? (
                <dl className="config-section__values">
                  {section.fields.map((field) => {
                    const parameter = parametersById.get(field.paramId)
                    return (
                      <div key={field.paramId} className="config-section__value-row">
                        <dt>
                          <span>{field.label}</span>
                          <small>{field.paramId}</small>
                        </dt>
                        <dd>{formatReadOnlyValue(parameter, field)}</dd>
                      </div>
                    )
                  })}
                </dl>
              ) : (
                <div className="config-section__editors">
                  {section.fields.map((field) => {
                    const parameter = parametersById.get(field.paramId)
                    if (!parameter) {
                      return (
                        <div
                          key={field.paramId}
                          className="config-section__missing-row"
                          data-testid={`config-field-missing-${field.paramId}`}
                        >
                          <span>{field.label}</span>
                          <small>{field.paramId}</small>
                          <span className="config-section__missing-value">— (not reported)</span>
                        </div>
                      )
                    }
                    const hasOptions = (parameter.definition?.options ?? []).length > 0
                    const editor =
                      parameter.definition?.bitmask && hasOptions ? (
                        <ScopedBitmaskField
                          parameter={parameter}
                          liveValue={parameter.value}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                        />
                      ) : hasOptions ? (
                        <ScopedSelectField
                          parameter={parameter}
                          liveValue={parameter.value}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                          layout="chips"
                        />
                      ) : (
                        <ScopedField
                          parameter={parameter}
                          liveValue={parameter.value}
                          editedValues={editedValues}
                          onChange={onEditChange}
                          draftStatusById={draftStatusById}
                          stepFallback={field.unit === 'rad' ? 0.001 : 1}
                        />
                      )
                    // Per-param "i" — hover/focus reveals the ArduPilot
                    // description right next to the field it documents.
                    const description = parameter.definition?.description
                    return (
                      <div key={field.paramId} className="config-section__field-row">
                        {editor}
                        {description ? (
                          <span className="config-section__info-wrap">
                            <button
                              type="button"
                              className="config-section__info"
                              data-testid={`config-field-info-${field.paramId}`}
                              aria-label={`About ${parameter.definition?.label ?? field.label}`}
                            >
                              i
                            </button>
                            <span className="config-section__info-tip" role="tooltip">
                              {description}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
              {!section.planned && section.footer ? (
                <div className="config-section__footer">{section.footer}</div>
              ) : null}
            </article>
          ))}
        </div>

        <div className="config-toolbar" data-testid="config-toolbar">
          <div className="config-toolbar__status">
            <span>{stagedCount} staged</span>
            <span>{invalidCount} invalid</span>
          </div>
          <button
            type="button"
            style={buttonStyle('primary')}
            onClick={onApply}
            disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            data-testid="config-apply"
          >
            {isApplying ? 'Applying…' : `Apply Config (${stagedCount})`}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            onClick={onRevert}
            disabled={isBusy || draftCount === 0}
            data-testid="config-revert"
          >
            Revert
          </button>
        </div>
      </Panel>
    </div>
  )
}
