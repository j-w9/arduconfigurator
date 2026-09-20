import { useMemo, useState, type ReactNode } from 'react'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { ScopedField, type ScopedFieldDraftMap } from './ScopedField'

/* Sub-tabs, by the kind of failsafe. The tab carried every row of every kind in
   one grid — RC, battery, GCS, EKF and the advanced options stacked together —
   so setting up one behaviour meant reading past four others.

   The groups are the row `source` values the builders already assign, so this
   is not a second classification to keep in sync. Sources listed below lead, in
   the order a build is worked through; ANY OTHER source becomes its own tab
   after them, in the order the rows arrive. That matters for the non-Copter
   vehicles, whose failsafes are their own: Plane has Short and Long failsafe,
   Rover a Failsafe action and a Crash check, Sub a Leak and internal
   pressure/temperature. Folding those into "Advanced" would bury the main
   failsafe of the vehicle. */
const FAILSAFE_LEADING_CATEGORIES: readonly string[] = [
  'RC failsafe',
  'Battery failsafe',
  'Fence',
  'GCS failsafe',
  'EKF failsafe'
]

/** Short tab labels — the panel is already called Failsafe, so a source ending
 *  in "failsafe" drops it. */
function categoryLabel(source: string): string {
  const trimmed = source.replace(/\s*failsafe$/i, '').trim()
  return trimmed.length > 0 ? trimmed : source
}

const categoryId = (source: string): string => source.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export interface FailsafeViewRow {
  source: string
  paramId: string
  formatted: string
  isSynced: boolean
  /** The live parameter, when present, so the row renders an inline editor.
   *  Absent (not synced) rows fall back to the read-only formatted value. */
  parameter?: ParameterState
}

export interface FailsafeViewProps {
  rows: readonly FailsafeViewRow[]
  /**
   * Extra cards per sub-tab, keyed by category id ('battery-failsafe',
   * 'fence', 'advanced', …), rendered under that tab's rows.
   *
   * This is how the metadata-backed "additional settings" reach the operator:
   * split by which failsafe each parameter belongs to instead of piled into one
   * card at the end. A key with no rows behind it (the fence) still earns a
   * tab.
   */
  extraSlots?: Record<string, ReactNode>
  // Staged-write editing (same draft model as every other param tab).
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

export function FailsafeView(props: FailsafeViewProps) {
  const {
    rows,
    extraSlots = {},
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

  // Only the groups this vehicle actually has rows for get a tab; a row whose
  // source is not in the canonical list still renders rather than vanishing —
  // it lands on Advanced, which is where an uncategorised knob belongs.
  const groups = useMemo(() => {
    const bySource = new Map<string, FailsafeViewRow[]>()
    for (const row of rows) {
      const existing = bySource.get(row.source)
      if (existing) existing.push(row)
      else bySource.set(row.source, [row])
    }
    const leading = FAILSAFE_LEADING_CATEGORIES.filter(
      (source) => bySource.has(source) || extraSlots[categoryId(source)] !== undefined
    )
    // Whatever this vehicle has that the list above does not name, in row
    // order — Plane's Short/Long, Rover's Failsafe action, Sub's Leak.
    const rest = [...bySource.keys()].filter(
      (source) => !FAILSAFE_LEADING_CATEGORIES.includes(source) && source !== 'Advanced'
    )
    // Advanced is always last and always present: it hosts the metadata-backed
    // extras and the planned servo-position card even with no rows of its own.
    return [...leading, ...rest, 'Advanced'].map((source) => ({
      source,
      id: categoryId(source),
      rows: bySource.get(source) ?? []
    }))
  }, [rows, extraSlots])

  const [activeCategory, setActiveCategory] = useState<string>(groups[0]?.id ?? 'rc-failsafe')
  const effectiveCategory = groups.some((group) => group.id === activeCategory)
    ? activeCategory
    : groups[0]?.id ?? 'rc-failsafe'
  const activeGroup = groups.find((group) => group.id === effectiveCategory)
  const visibleRows = activeGroup?.rows ?? []

  // A staged edit on a tab you are not looking at is never invisible.
  const unsavedByCategory = useMemo(() => {
    const set = new Set<string>()
    for (const group of groups) {
      if (group.rows.some((row) => {
        const status = draftStatusById.get(row.paramId)?.status
        return status === 'staged' || status === 'invalid'
      })) {
        set.add(group.id)
      }
    }
    return set
  }, [groups, draftStatusById])

  return (
    <div id="setup-panel-failsafe">
      <Panel title="Failsafe" subtitle="What the vehicle does when something goes wrong.">
        <div className="modes-stack">
          {/* The three summary cards (RC failsafe / Battery low / Battery
              critical) used to sit here, restating an action and a threshold
              that the rows below now show in full — and, since the tab is
              grouped by kind of failsafe, on the very tab you are standing on.
              A summary of the thing you are looking at is not a summary. */}

          <div className="tab-strip failsafe-category-nav" data-testid="failsafe-category-nav" role="tablist">
            {groups.map((group) => {
              const isActive = group.id === effectiveCategory
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`tab-strip__tab${isActive ? ' is-active' : ''}`}
                  data-testid={`failsafe-category-${group.id}`}
                  onClick={() => setActiveCategory(group.id)}
                >
                  <span className="tab-strip__tab-title">{categoryLabel(group.source)}</span>
                  {unsavedByCategory.has(group.id) ? (
                    <span className="config-category-nav__dot" title="Unsaved changes in this group" aria-label="unsaved changes" />
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="config-grid" data-testid="failsafe-editor-grid">
            {visibleRows.map((row) => (
              <article
                key={row.paramId}
                className="config-section"
                data-testid={`failsafe-row-${row.paramId}`}
              >
                <div className="config-section__header">
                  <span className="config-section__kicker">{row.source}</span>
                </div>
                {row.parameter ? (
                  <ScopedField
                    parameter={row.parameter}
                    liveValue={row.parameter.value}
                    editedValues={editedValues}
                    draftStatusById={draftStatusById}
                    onChange={onEditChange}
                    stepFallback={row.parameter.definition?.step ?? 1}
                  />
                ) : (
                  <div className="scoped-editor-field scoped-editor-field--compact">
                    <span>{row.paramId}</span>
                    <p className="scoped-editor-field__readonly">{row.formatted}</p>
                    <StatusBadge tone="warning">not synced</StatusBadge>
                  </div>
                )}
              </article>
            ))}
          </div>

          {/* Above the Save/Revert footer: the footer ends the tab, so an
              extra card under it read as belonging to the next thing. */}
          {extraSlots[effectiveCategory] ?? null}

          <div className="scoped-editor-footer" data-testid="failsafe-editor-footer">
            <div className="scoped-editor-footer__counts">
              <span>{stagedCount} staged</span>
              <span>{invalidCount} invalid</span>
            </div>
            <button
              type="button"
              data-testid="failsafe-save"
              style={buttonStyle('primary')}
              onClick={onApply}
              disabled={isBusy || stagedCount === 0 || invalidCount > 0 || !canApply}
            >
              {isApplying ? 'Applying…' : `Save Failsafe (${stagedCount})`}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              onClick={onRevert}
              disabled={isBusy || draftCount === 0}
            >
              Revert
            </button>
          </div>

          {effectiveCategory === 'advanced' ? (
          <section
            className="failsafe-placeholder failsafe-servo-position"
            data-testid="failsafe-servo-position-placeholder"
            aria-label="Servo failsafe positions"
          >
            <header className="failsafe-placeholder__header">
              <div>
                <strong>Servo failsafe positions</strong>
                <p>
                  Per-channel servo PWM target when an active failsafe triggers — a Mission Planner / BF style
                  per-output failsafe-position editor (e.g. centre rudder + cut throttle on RC loss). Will edit
                  SERVOn_FUNCTION sibling params for the failsafe pose; landing here under Failsafe instead of
                  Servos so all loss-of-link behavior stays in one tab.
                </p>
              </div>
              <StatusBadge tone="warning">planned</StatusBadge>
            </header>
            <p className="failsafe-placeholder__note">
              Placeholder only. Until this ships, set per-servo failsafe positions via the autopilot&apos;s
              Parameters tab.
            </p>
          </section>
          ) : null}

        </div>
      </Panel>
    </div>
  )
}
