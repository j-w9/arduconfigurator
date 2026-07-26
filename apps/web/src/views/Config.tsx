import { useMemo, useState, type ReactNode } from 'react'

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
  /** Rarely-touched field folded into a per-card "Advanced" disclosure,
   *  so each card leads with the knobs an operator actually reaches for. */
  advanced?: boolean
}

/** Config category ids — the top tab groups. */
export type ConfigCategoryId = 'airframe' | 'sensors' | 'gps' | 'rc-arming' | 'system'

export interface ConfigCategory {
  id: ConfigCategoryId
  label: string
}

// Tab order across the top of the Config surface. One calm group at a time
// instead of 14 stacked cards.
export const CONFIG_CATEGORIES: readonly ConfigCategory[] = [
  { id: 'airframe', label: 'Airframe' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'gps', label: 'GPS' },
  { id: 'rc-arming', label: 'RC & Arming' },
  { id: 'system', label: 'System' }
]

export interface ConfigSection {
  id: string
  title: string
  description: string
  fields: readonly ConfigSectionField[]
  /** Which top-tab group this section belongs to. */
  category?: ConfigCategoryId
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

// A field carries an unsaved edit when its draft status is staged or invalid.
function fieldHasUnsaved(draftStatusById: ScopedFieldDraftMap, paramId: string): boolean {
  const status = draftStatusById.get(paramId)?.status
  return status === 'staged' || status === 'invalid'
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

  // Categories that actually have sections for this vehicle/build — an empty
  // group never gets a tab.
  const presentCategories = useMemo(
    () => CONFIG_CATEGORIES.filter((category) => sections.some((section) => section.category === category.id)),
    [sections]
  )

  const [activeCategory, setActiveCategory] = useState<ConfigCategoryId>(presentCategories[0]?.id ?? 'airframe')
  // Keep the active tab valid if the section set changes under us.
  const effectiveCategory = presentCategories.some((category) => category.id === activeCategory)
    ? activeCategory
    : presentCategories[0]?.id ?? 'airframe'

  // Which categories hold an unsaved edit, for the tab dot — so a staged change
  // on a tab you're not looking at is never invisible.
  const unsavedByCategory = useMemo(() => {
    const set = new Set<ConfigCategoryId>()
    for (const section of sections) {
      if (!section.category || section.readOnly) continue
      if (section.fields.some((field) => fieldHasUnsaved(draftStatusById, field.paramId))) {
        set.add(section.category)
      }
    }
    return set
  }, [sections, draftStatusById])

  const visibleSections = useMemo(
    () => sections.filter((section) => (section.category ?? 'system') === effectiveCategory),
    [sections, effectiveCategory]
  )

  // One editable field row (or the "(not reported)" placeholder). Shared by the
  // common set and the folded Advanced set.
  function renderField(field: ConfigSectionField): ReactNode {
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
  }

  return (
    <div id="setup-panel-config">
      <Panel
        title="Config"
        subtitle="Airframe, sensors, GPS, RC & arming, and system settings — grouped so you only see one area at a time."
      >
        {presentCategories.length > 1 ? (
          <div className="tab-strip config-category-nav" data-testid="config-category-nav" role="tablist">
            {presentCategories.map((category) => {
              const isActive = category.id === effectiveCategory
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`tab-strip__tab${isActive ? ' is-active' : ''}`}
                  data-testid={`config-category-${category.id}`}
                  onClick={() => setActiveCategory(category.id)}
                >
                  <span className="tab-strip__tab-title">{category.label}</span>
                  {unsavedByCategory.has(category.id) ? (
                    <span className="config-category-nav__dot" title="Unsaved changes in this group" aria-label="unsaved changes" />
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="config-grid" data-testid="config-section-grid">
          {visibleSections.map((section) => (
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
                (() => {
                  const commonFields = section.fields.filter((field) => !field.advanced)
                  const advancedFields = section.fields.filter((field) => field.advanced)
                  // If a card is ALL advanced (shouldn't happen, but guard),
                  // show them as common rather than an empty card behind a fold.
                  const [leadFields, foldedFields] =
                    commonFields.length > 0 ? [commonFields, advancedFields] : [advancedFields, []]
                  const foldedUnsaved = foldedFields.some((field) => fieldHasUnsaved(draftStatusById, field.paramId))
                  return (
                    <div className="config-section__editors">
                      {leadFields.map((field) => renderField(field))}
                      {foldedFields.length > 0 ? (
                        <details
                          className="config-section__advanced"
                          data-testid={`config-advanced-${section.id}`}
                          // Auto-open when a folded field has an unsaved edit (so
                          // it's never hidden); otherwise `undefined` leaves the
                          // disclosure user-toggleable rather than force-closed.
                          open={foldedUnsaved || undefined}
                        >
                          <summary>
                            Advanced
                            <span className="config-section__advanced-count">{foldedFields.length}</span>
                            {foldedUnsaved ? <span className="config-category-nav__dot" aria-label="unsaved changes" /> : null}
                          </summary>
                          <div className="config-section__editors config-section__editors--advanced">
                            {foldedFields.map((field) => renderField(field))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  )
                })()
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
