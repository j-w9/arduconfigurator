// ParametersSection — App.tsx's expert-only `activeViewId === 'parameters'`
// block (~360 lines): raw parameter table with search, per-row inline edit,
// staged / invalid / reboot-required draft groups, the import-backup file
// input + three export buttons, and the selected-parameter detail card.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactElement, ReactNode, RefObject, SetStateAction } from 'react'
import { parameterAlias } from '@arduconfig/ardupilot-core'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterDraftGroup, ParameterDraftSummary, ParameterImportCategory, ParameterState } from '@arduconfig/ardupilot-core'
import type { NormalizedFirmwareMetadataBundle } from '@arduconfig/param-metadata'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'
import type { PendingParameterImport } from '../hooks/use-parameter-backup-io'
import { useDraftSelection } from '../hooks/use-draft-selection'
import { selectEntityDiff } from '../selectors/entity-diff'
import {
  isOverridableInvalidEntry,
  overridableInvalidParamIds,
  paramIdsForGroup
} from '../view-models/parameter-diff-actions'
import { ParameterDiffGroupActions } from '../views/ParameterDiffGroupActions'
import { ParameterDiffIdentity, ParameterDiffInvalidRow } from '../views/ParameterDiffRow'
import { applyDraftSelectionClick } from '../view-models/draft-selection'
import {
  detectPresetDependencies,
  inferBatteryCellCount,
  presetDependencyClass,
  type PresetDependencyClassId,
  type PresetDependencyContext,
  type PresetDependencyRecord
} from '../view-models/preset-dependencies'
import { CreatePresetDialog, type CreatePresetParam, type CreatePresetQuestion } from '../views/CreatePresetDialog'
import type { UserPresetDraft } from '../user-preset-library'

import {
  formatParameterDelta,
  formatParameterValue,
  formatParameterDraftValue
} from '../parameter-format'
import { ScopedBitmaskPopover } from '../views/ScopedField'
import { ParameterDetail } from '../views/ParameterDetail'
import { parameterApplyBlockedReason } from '../apply-gate'
import { parameterSearchPredicate } from '../view-models/filtered-parameters'
import { toneForParameterDraftStatus } from '../tone-helpers'
import type { ParameterFollowUp, ParameterNotice } from '../hooks/use-parameter-feedback'
import { UploadToLogServerButton } from '../views/UploadToLogServerButton'
import type { ArtifactUploadAnswers, ArtifactUploadTarget } from '../view-models/artifact-upload-target'
import type { ArtifactUpload } from '../hooks/use-artifact-upload'

export interface ParametersSectionProps {
  snapshot: ConfiguratorSnapshot
  metadataCatalog: NormalizedFirmwareMetadataBundle
  canApplyDraftParameters: boolean
  canApplyAllDraftParameters: boolean
  /** "Reset to Defaults" control, rendered near the top — see
   *  ResetToDefaultsButton. */
  resetToDefaultsSlot?: ReactNode
  busyAction: string | undefined
  /** Label for the Apply-All button while the batch write is in flight, e.g. "Writing… (12/200)". */
  applyAllBusyLabel: string
  editedValues: Record<string, string>
  parameterNotice: ParameterNotice | undefined
  parameterFollowUp: ParameterFollowUp | undefined
  /** Bumped by the global draft bar's "Show changes" button — a plain
   *  boolean can't refire on a second click while already on this tab, so
   *  App increments a counter instead. Any change scrolls the diff grid
   *  into view (invalid rows first, since those block Apply All). */
  scrollToChangesRequestId: number
  formatCategoryLabel: (categoryId: string | undefined) => string
  parameterSearch: string
  setParameterSearch: Dispatch<SetStateAction<string>>
  /** Strict search: literal substring instead of fuzzy scoring. */
  parameterExactSearch: boolean
  setParameterExactSearch: Dispatch<SetStateAction<boolean>>
  selectedParameterId: string | undefined
  setSelectedParameterId: Dispatch<SetStateAction<string | undefined>>
  filteredParameters: readonly ParameterState[]
  parameterDraftSummary: ParameterDraftSummary
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  stagedParameterGroups: readonly ParameterDraftGroup[]
  invalidParameterGroups: readonly ParameterDraftGroup[]
  rebootRequiredDrafts: readonly ParameterDraftEntry[]
  stagedParameterDrafts: readonly ParameterDraftEntry[]
  parameterBackupInputRef: RefObject<HTMLInputElement | null>
  setDraft: (paramId: string, value: string) => void
  onApplyAllParameterDrafts: () => void | Promise<void>
  onDiscardAllParameterDrafts: () => void
  onApplyParameterDraft: (draft: ParameterDraftEntry) => void | Promise<void>
  onDiscardParameterDraft: (paramId: string) => void
  onOpenParameterBackup: () => void
  /** Opt-in categories to strip from the next backup import (all false = none). */
  parameterImportExclusions: Record<ParameterImportCategory, boolean>
  onToggleParameterImportExclusion: (category: ParameterImportCategory) => void
  /** Categories to leave OUT of exported backups (calibration/stream-rates/mission). */
  parameterExportExclusions: Record<ParameterImportCategory, boolean>
  onToggleParameterExportExclusion: (category: ParameterImportCategory) => void
  onExportParameterBackup: () => void
  /** Upload the JSON backup to the operator's log server, filed by aircraft. */
  handleUploadParameterBackup: (answers: ArtifactUploadAnswers) => void
  /** The derived name/folder the upload form prefills. */
  parameterBackupUploadTarget: ArtifactUploadTarget
  artifactUpload: ArtifactUpload
  onExportParameterBackupAsParm: () => void
  onExportParameterBackupAsParams: () => void
  onImportParameterBackup: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>
  /** Pull the parameter list fresh from the FC — bypasses the auto-refresh
   *  and gives the operator a manual re-sync button inline in the toolbar. */
  onRefreshParameters: () => void | Promise<void>
  /** True when a refresh / pull is in flight; used to disable the button. */
  refreshDisabled: boolean
  /** Set of paramIds that the operator has chosen to "Override and write
   *  anyway" — only applies to enum-mismatch invalidity, since metadata
   *  can lag firmware on legitimate new enum values. */
  parameterEnumOverrides: ReadonlySet<string>
  onToggleParameterEnumOverride: (paramId: string) => void
  /** Trigger a vehicle reboot directly from the post-write follow-up prompt, so
   *  a reboot-required change can be completed without scrolling back up to the
   *  header session strip. */
  onRequestReboot: () => void
  /** Params the FC reports as differing from firmware default (from MAVFTP
   *  param.pck?withdefaults, 4.5+). null = not fetched yet. */
  nonDefaultParamIds: ReadonlySet<string> | null
  /** Firmware defaults from param.pck, once fetched. Null = not fetched. */
  parameterDefaults?: ReadonlyMap<string, number> | null
  /** "Show only changed" — restrict the table (and export) to non-default params. */
  showOnlyNonDefault: boolean
  /** A backup that has been read but NOT staged. */
  pendingParameterImport: PendingParameterImport | undefined
  onStagePendingParameterImport: () => void
  /** Stage one row or one category of the pending import. */
  onStagePendingParameterImportSubset: (paramIds: readonly string[]) => void
  /** What an imported draft originally asked for, keyed by param id. */
  importedDraftOrigins: Record<string, string>
  /** Drop rows from the pending import without staging them. */
  onDropPendingParameterImportEntries: (paramIds: readonly string[]) => void
  onDismissPendingParameterImport: () => void
  /** Params verified-written in the last few seconds — briefly flagged green. */
  recentlyWrittenParamIds: ReadonlySet<string>
  onToggleShowOnlyNonDefault: () => void
  /** Fetch the packed defaults from the FC to populate nonDefaultParamIds. */
  onFetchParamDefaults: () => void | Promise<void>
  /** True while the defaults fetch is in flight. */
  fetchDefaultsBusy: boolean
  /** Save a group of selected parameters as a reusable preset. Read-only —
   *  nothing is written to the aircraft. Omitting it hides the whole control. */
  onCreateUserPreset?: (draft: UserPresetDraft) => void
}

export function ParametersSection(props: ParametersSectionProps): ReactElement {
  const {
    snapshot,
    metadataCatalog,
    canApplyDraftParameters,
    canApplyAllDraftParameters,
    resetToDefaultsSlot,
    busyAction,
    applyAllBusyLabel,
    editedValues,
    parameterNotice,
    parameterFollowUp,
    scrollToChangesRequestId,
    formatCategoryLabel,
    parameterSearch,
    setParameterSearch,
    parameterExactSearch,
    setParameterExactSearch,
    selectedParameterId,
    setSelectedParameterId,
    filteredParameters,
    parameterDraftSummary,
    parameterDraftById,
    stagedParameterGroups,
    invalidParameterGroups,
    rebootRequiredDrafts,
    stagedParameterDrafts,
    parameterBackupInputRef,
    setDraft,
    onApplyAllParameterDrafts: handleApplyAllParameterDrafts,
    onDiscardAllParameterDrafts: handleDiscardAllParameterDrafts,
    onApplyParameterDraft: handleApplyParameterDraft,
    onDiscardParameterDraft: handleDiscardParameterDraft,
    onOpenParameterBackup: handleOpenParameterBackup,
    parameterImportExclusions,
    onToggleParameterImportExclusion: handleToggleParameterImportExclusion,
    parameterExportExclusions,
    onToggleParameterExportExclusion: handleToggleParameterExportExclusion,
    onExportParameterBackup: handleExportParameterBackup,
    handleUploadParameterBackup,
    parameterBackupUploadTarget,
    artifactUpload,
    onExportParameterBackupAsParm: handleExportParameterBackupAsParm,
    onExportParameterBackupAsParams: handleExportParameterBackupAsParams,
    onImportParameterBackup: handleImportParameterBackup,
    onRefreshParameters: handleRefreshParameters,
    refreshDisabled,
    parameterEnumOverrides,
    onToggleParameterEnumOverride: handleToggleParameterEnumOverride,
    onRequestReboot: handleRequestReboot,
    nonDefaultParamIds,
    parameterDefaults,
    showOnlyNonDefault,
    pendingParameterImport,
    onStagePendingParameterImport,
    onStagePendingParameterImportSubset,
    onDropPendingParameterImportEntries,
    importedDraftOrigins,
    onDismissPendingParameterImport,
    recentlyWrittenParamIds,
    onToggleShowOnlyNonDefault: handleToggleShowOnlyNonDefault,
    fetchDefaultsBusy,
    onCreateUserPreset
  } = props

  // Bulk-drop selection over the staged review rows — dropping unwanted
  // rows one-by-one after loading a large backup doesn't scale. Pure view
  // state, so it lives here. Shift-click range semantics are in
  // view-models/draft-selection.ts (unit-tested); the anchor is the last
  // row whose checkbox was clicked.

  // After a write, bring the reboot-required follow-up (and its inline Request
  // Reboot button) into view, so a reboot-required change can be completed
  // without scrolling back up the param list to find the prompt.
  const rebootFollowUpRef = useRef<HTMLDivElement>(null)
  const followUpRequiresReboot = parameterFollowUp?.requiresReboot ?? false
  useEffect(() => {
    if (followUpRequiresReboot) {
      rebootFollowUpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [followUpRequiresReboot])
  // "Show changes" (the global draft bar) switches to this tab but previously
  // dropped the operator wherever they last scrolled, leaving the diff grid
  // to hunt for — the reported bug. Scroll to it on every request; invalid
  // rows first since those block Apply All, matching the existing "jump to
  // them" anchor link below. Runs on mount too (a fresh tab switch), since a
  // dependency changing on the very first render still fires the effect.
  const stagedDiffGridRef = useRef<HTMLDivElement>(null)
  const invalidDiffGridRef = useRef<HTMLDivElement>(null)
  // The app header is sticky, so a plain scrollIntoView({block:'start'}) — and a
  // plain "#id" anchor jump — parks the target UNDER it. The invalid callout's
  // "jump to them" landed with the invalid block scrolled off the top, showing
  // the parameter table instead of the thing it promised to jump to. Same
  // header offset scrollToPanel uses in App.tsx.
  const HEADER_OFFSET_PX = 112
  const scrollToReviewTarget = useCallback((target: HTMLElement | null) => {
    if (!target) return
    window.scrollTo({
      top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - HEADER_OFFSET_PX),
      behavior: 'smooth'
    })
  }, [])
  useEffect(() => {
    if (scrollToChangesRequestId === 0) return
    scrollToReviewTarget(invalidDiffGridRef.current ?? stagedDiffGridRef.current)
  }, [scrollToChangesRequestId, scrollToReviewTarget])

  // Editing a row must not move that row out from under the operator. Staging
  // the first draft inserts the whole staged-review block (~200px, more once it
  // carries several categories) ABOVE the parameter table, so every row below it
  // moves that far down the DOCUMENT — measured on the demo copter: the edited
  // row's document top went 3557 -> 3759 (+202) on a single AUTOTUNE_AXES bit
  // toggle. Blink and Gecko hide that with native scroll anchoring (scrollY
  // silently absorbs the +202 and the row's viewport position is unchanged), so
  // the shift is invisible THERE and only there: WebKit implements no scroll
  // anchoring at all, and Blink itself suppresses the adjustment in several
  // documented cases. With anchoring off the same toggle slides the row 202px
  // down the viewport mid-edit, which is the reported "changing a bitmask throws
  // me up the page and I have to scroll back down to where I was" — an operator
  // report whose browser was not captured, so the app must not depend on a
  // browser feature to hold the row. Rather than disable or fight
  // the browser's anchoring, measure what it did NOT absorb and make up only the
  // difference: record the row's viewport top at the moment of the edit, then in
  // the layout effect after React commits (before paint, so no flicker) scroll by
  // the residual drift. Where the browser already anchored, the residual is 0 and
  // this does nothing at all.
  const pendingRowAnchorRef = useRef<{ paramId: string; top: number } | undefined>(undefined)
  const parameterRowElement = (paramId: string): HTMLElement | null => {
    if (typeof document === 'undefined') return null
    return document.querySelector<HTMLElement>(`.parameter-row[data-param-row="${CSS.escape(paramId)}"]`)
  }
  const setDraftKeepingRowInPlace = useCallback(
    (paramId: string, value: string) => {
      const top = parameterRowElement(paramId)?.getBoundingClientRect().top
      pendingRowAnchorRef.current = top === undefined ? undefined : { paramId, top }
      setDraft(paramId, value)
    },
    [setDraft]
  )
  // Deliberately un-keyed: it has to run on the commit that follows the edit,
  // and the pending anchor (cleared on every commit) is what gates the work, so
  // an unrelated re-render costs one ref read.
  useLayoutEffect(() => {
    const pending = pendingRowAnchorRef.current
    pendingRowAnchorRef.current = undefined
    if (!pending) return
    // The row can legitimately be gone (a search/category filter re-evaluated,
    // or "show only changed" dropped it) — there is nothing to hold still then.
    const top = parameterRowElement(pending.paramId)?.getBoundingClientRect().top
    if (top === undefined) return
    const drift = top - pending.top
    // Sub-pixel drift is layout rounding, not a jump; scrolling for it would
    // just add noise.
    if (Math.abs(drift) < 1) return
    window.scrollBy({ top: drift, left: 0, behavior: 'instant' as ScrollBehavior })
  })
  // The search box filters the staged review too: filtering only the
  // table while the review list (where you look mid-import) ignores it
  // makes wildcard search appear broken. Selection, Select all, and Drop
  // selected operate on visible rows only, so a filtered bulk drop can
  // never touch rows the search is hiding.
  const searchPredicate = useMemo(
    () => parameterSearchPredicate(parameterSearch, parameterExactSearch),
    [parameterSearch, parameterExactSearch]
  )
  // Category filter (in addition to the text search). 'all' = no category
  // restriction. Options are the distinct categories present in the synced
  // tree, label-sorted.
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const categoryOf = (parameter: ParameterState): string | undefined =>
    metadataCatalog.parameters[parameter.id]?.category ?? parameter.definition?.category
  const categoryOptions = useMemo(() => {
    const present = new Set<string>()
    for (const parameter of snapshot.parameters) {
      const category = categoryOf(parameter)
      if (category) {
        present.add(category)
      }
    }
    return [...present].sort((left, right) => formatCategoryLabel(left).localeCompare(formatCategoryLabel(right)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.parameters, metadataCatalog, formatCategoryLabel])
  const displayedParameters = useMemo(
    () => {
      const byCategory =
        categoryFilter === 'all'
          ? filteredParameters
          : filteredParameters.filter((parameter) => categoryOf(parameter) === categoryFilter)
      // "Show only changed" — restrict to params the FC reported as non-default.
      if (showOnlyNonDefault && nonDefaultParamIds) {
        return byCategory.filter((parameter) => nonDefaultParamIds.has(parameter.id))
      }
      return byCategory
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredParameters, categoryFilter, metadataCatalog, showOnlyNonDefault, nonDefaultParamIds]
  )
  // ---------------------------------------------------------------------
  // "Create preset" — row selection over the parameter TABLE
  // ---------------------------------------------------------------------
  // A second selection set, distinct from the staged-review bulk-drop one below
  // because it selects live parameters rather than pending drafts. It shares the
  // shift-click RULE (applyDraftSelectionClick) but deliberately not
  // useDraftSelection: that hook prunes any selected id missing from the ordered
  // list, which is right when a row leaves by being dropped and wrong here,
  // where rows leave because the operator typed in the search box. Pruning on a
  // filter change would silently empty a selection built across two categories.
  //
  // The visible-rows-only rule from bulk drop still holds, and is stated in the
  // UI: Select all and Create preset act on what is on screen, so a filtered
  // action can never reach into rows the filter is hiding. Ids selected and then
  // filtered away are kept, counted separately, and come back with the filter.
  const [presetSelection, setPresetSelection] = useState<ReadonlySet<string>>(() => new Set())
  const presetSelectionAnchorRef = useRef<string | null>(null)
  const displayedParameterIds = useMemo(() => displayedParameters.map((parameter) => parameter.id), [displayedParameters])
  const visibleSelectedParamIds = useMemo(
    () => displayedParameterIds.filter((id) => presetSelection.has(id)),
    [displayedParameterIds, presetSelection]
  )
  const hiddenSelectedCount = presetSelection.size - visibleSelectedParamIds.length
  const allVisibleSelected = displayedParameterIds.length > 0 && visibleSelectedParamIds.length === displayedParameterIds.length

  const handlePresetSelectionClick = useCallback(
    (paramId: string, shiftKey: boolean) => {
      setPresetSelection((current) =>
        applyDraftSelectionClick(current, displayedParameterIds, paramId, {
          shiftKey,
          anchorId: presetSelectionAnchorRef.current
        })
      )
      presetSelectionAnchorRef.current = paramId
    },
    [displayedParameterIds]
  )

  const handleSelectAllVisible = useCallback(
    (selected: boolean) => {
      setPresetSelection((current) => {
        const next = new Set(current)
        displayedParameterIds.forEach((id) => (selected ? next.add(id) : next.delete(id)))
        return next
      })
      presetSelectionAnchorRef.current = null
    },
    [displayedParameterIds]
  )

  // Live values + metadata, looked up often enough while the dialog is open to
  // be worth a map rather than a linear scan per parameter.
  const liveValueById = useMemo(
    () => new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter.value])),
    [snapshot.parameters]
  )
  const readLiveParameter = useCallback((paramId: string) => liveValueById.get(paramId), [liveValueById])
  const definitionOf = useCallback(
    (paramId: string) =>
      metadataCatalog.parameters[paramId] ?? snapshot.parameters.find((parameter) => parameter.id === paramId)?.definition,
    [metadataCatalog, snapshot.parameters]
  )

  // Dialog state. `presetDraftIds` is a snapshot of the selection taken when the
  // dialog opens: the table underneath stays live, and a filter change (or an
  // auto-refresh dropping a row) must not silently change what is about to be
  // saved.
  const [createPresetOpen, setCreatePresetOpen] = useState(false)
  const [presetDraftIds, setPresetDraftIds] = useState<readonly string[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetDescription, setPresetDescription] = useState('')
  const [presetExcludedIds, setPresetExcludedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [presetAnsweredClasses, setPresetAnsweredClasses] = useState<ReadonlySet<string>>(() => new Set())
  const [presetCellCount, setPresetCellCount] = useState('')

  const presetKeptIds = useMemo(
    () => presetDraftIds.filter((id) => !presetExcludedIds.has(id)),
    [presetDraftIds, presetExcludedIds]
  )
  // Re-detect over what is actually KEPT, so dropping the last SERIAL3 row also
  // removes the serial-port question instead of leaving a dependency recorded
  // against parameters the preset no longer contains.
  const presetDetection = useMemo(
    () =>
      detectPresetDependencies({
        paramIds: presetKeptIds,
        readParameter: readLiveParameter,
        isRebootRequired: (paramId) => definitionOf(paramId)?.rebootRequired === true
      }),
    [presetKeptIds, readLiveParameter, definitionOf]
  )

  // Calibration ids come from the FULL selection, not from presetDetection:
  // they are excluded by default, so by the time detection runs over the kept
  // set the class has disappeared — and the warning explaining why they were
  // dropped would disappear with it.
  const presetCalibrationParamIds = useMemo(
    () =>
      detectPresetDependencies({ paramIds: presetDraftIds, readParameter: readLiveParameter }).dependencies.find(
        (entry) => entry.classId === 'calibration'
      )?.paramIds ?? [],
    [presetDraftIds, readLiveParameter]
  )

  const handleOpenCreatePreset = useCallback(() => {
    const ids = visibleSelectedParamIds
    const initial = detectPresetDependencies({ paramIds: ids, readParameter: readLiveParameter })
    setPresetDraftIds(ids)
    // Per-board calibration is excluded BY DEFAULT rather than merely flagged:
    // a compass offset is never valid on another board, so the safe default is
    // to leave it out. Fully reversible per row ("Keep"), and the dialog says
    // so in a warning banner, so this is a default and not a decision taken
    // away from the operator.
    setPresetExcludedIds(
      new Set(initial.dependencies.find((entry) => entry.classId === 'calibration')?.paramIds ?? [])
    )
    setPresetAnsweredClasses(new Set(initial.dependencies.map((entry) => entry.classId)))
    setPresetCellCount(String(inferBatteryCellCount(readLiveParameter) ?? ''))
    setPresetName('')
    setPresetDescription('')
    setCreatePresetOpen(true)
  }, [visibleSelectedParamIds, readLiveParameter])

  const handleToggleDependencyAnswer = useCallback((classId: string) => {
    setPresetAnsweredClasses((current) => {
      const next = new Set(current)
      if (next.has(classId)) {
        next.delete(classId)
      } else {
        next.add(classId)
      }
      return next
    })
  }, [])

  const handleTogglePresetParamExcluded = useCallback((paramId: string) => {
    setPresetExcludedIds((current) => {
      const next = new Set(current)
      if (next.has(paramId)) {
        next.delete(paramId)
      } else {
        next.add(paramId)
      }
      return next
    })
  }, [])

  const handleSaveUserPreset = useCallback(() => {
    if (!onCreateUserPreset) {
      return
    }
    const values = presetKeptIds
      .map((paramId) => ({ paramId, value: liveValueById.get(paramId) }))
      .filter((entry): entry is { paramId: string; value: number } => entry.value !== undefined && Number.isFinite(entry.value))

    const typedCells = Number.parseInt(presetCellCount, 10)
    const dependencies: PresetDependencyRecord[] = presetDetection.dependencies
      .filter((entry) => presetAnsweredClasses.has(entry.classId))
      .map((entry) => {
        const context: PresetDependencyContext = { ...entry.context }
        // The operator's typed cell count wins over the MOT_BAT_VOLT_MAX
        // inference — they know the pack, the inference only guessed at it.
        if (entry.classId === 'battery-pack') {
          if (Number.isFinite(typedCells) && typedCells >= 2 && typedCells <= 14) {
            context.batteryCells = typedCells
          } else {
            delete context.batteryCells
          }
        }
        return { classId: entry.classId, paramIds: entry.paramIds, context }
      })

    onCreateUserPreset({
      label: presetName.trim(),
      description: presetDescription.trim(),
      values,
      dependencies
    })
    setCreatePresetOpen(false)
    setPresetSelection(new Set())
    presetSelectionAnchorRef.current = null
  }, [
    onCreateUserPreset,
    presetKeptIds,
    liveValueById,
    presetCellCount,
    presetDetection,
    presetAnsweredClasses,
    presetName,
    presetDescription
  ])

  const createPresetParams = useMemo<CreatePresetParam[]>(
    () =>
      presetDraftIds.map((paramId) => {
        const definition = definitionOf(paramId)
        return {
          id: paramId,
          label: definition?.label ?? paramId,
          description: definition?.description,
          valueText: formatParameterValue(liveValueById.get(paramId) ?? Number.NaN, definition?.unit),
          excluded: presetExcludedIds.has(paramId)
        }
      }),
    [presetDraftIds, presetExcludedIds, definitionOf, liveValueById]
  )

  const createPresetQuestions = useMemo<CreatePresetQuestion[]>(
    () =>
      presetDetection.dependencies.map((entry) => {
        const descriptor = presetDependencyClass(entry.classId as PresetDependencyClassId)
        return {
          classId: entry.classId,
          label: descriptor.label,
          question: descriptor.question,
          rationale: descriptor.rationale,
          detail: entry.detail,
          checked: presetAnsweredClasses.has(entry.classId)
        }
      }),
    [presetDetection, presetAnsweredClasses]
  )

  const visibleStagedGroups = useMemo(() => {
    if (!searchPredicate) {
      return stagedParameterGroups
    }
    return stagedParameterGroups
      .map((group) => ({ ...group, entries: group.entries.filter((draft) => searchPredicate(draft.id, draft.label)) }))
      .filter((group) => group.entries.length > 0)
  }, [stagedParameterGroups, searchPredicate])
  const hiddenStagedCount =
    stagedParameterGroups.reduce((sum, group) => sum + group.entries.length, 0) -
    visibleStagedGroups.reduce((sum, group) => sum + group.entries.length, 0)
  const stagedOrderedIds = useMemo(
    () => visibleStagedGroups.flatMap((group) => group.entries.map((entry) => entry.id)),
    [visibleStagedGroups]
  )
  // Shift-click ranges, select-all, pruning of ids that have left the list —
  // shared with the Snapshots restore preview via useDraftSelection.
  const {
    selectedIds: selectedDraftIds,
    handleSelectionClick: handleDraftSelectionClick,
    setAllSelected: setAllDraftsSelected,
    forgetIds: forgetSelectedDraftIds,
    clearSelection: clearDraftSelection,
    allSelected: allDraftsSelected
  } = useDraftSelection(stagedOrderedIds)
  // Drop every staged row in one category. Also clears those ids from the
  // checkbox selection, so a subsequent "Drop selected" count doesn't include
  // rows that are already gone.
  // The pending import rendered as a real diff (current -> imported), grouped by
  // category. Held OUT of the draft set, these values were previously invisible:
  // the prompt offered only "Stage all" or "Discard", and the parameter rows
  // below showed "No local draft" because nothing was staged. So there was no
  // way to take part of an import — worse than the old auto-stage-everything
  // behaviour it replaced.
  const pendingImportDiff = useMemo(
    () =>
      pendingParameterImport
        ? selectEntityDiff(snapshot.parameters, pendingParameterImport.draftValues, parameterEnumOverrides)
        : undefined,
    [pendingParameterImport, snapshot.parameters, parameterEnumOverrides]
  )

  // Invalid rows in a group that an override can still rescue, excluding ones
  // already overridden — shared with the Snapshots restore preview.
  const overridableGroupIds = (group: ParameterDraftGroup): string[] =>
    overridableInvalidParamIds(group.entries, parameterEnumOverrides)

  const handleDropDraftGroup = (draftIds: string[]): void => {
    draftIds.forEach((draftId) => handleDiscardParameterDraft(draftId))
    forgetSelectedDraftIds(draftIds)
  }

  const handleDropSelectedDrafts = (): void => {
    selectedDraftIds.forEach((draftId) => handleDiscardParameterDraft(draftId))
    clearDraftSelection()
  }

  // Draft-status lookup for the bitmask checkbox editor (ScopedBitmaskField
  // reads it for staged styling + the "was" line). Built once per draft set
  // rather than a fresh map per row.
  const draftStatusMap = useMemo<ReadonlyMap<string, { status: string }>>(
    () => new Map(Array.from(parameterDraftById, ([id, entry]) => [id, { status: entry.status }])),
    [parameterDraftById]
  )

  // selectedParameterId now drives the inline row EXPANSION (click a row to
  // reveal its ParameterDetail — metadata, old name, enum meanings, richer
  // editor). It no longer feeds a separate inspector card.

  return (

      <Panel title="Parameter Editor" subtitle="Browse, stage, and write raw parameter values.">
        <div className="parameter-follow-up parameter-follow-up--warning parameter-editor__expert-note">
          <StatusBadge tone="warning">expert</StatusBadge>
          <p>Raw parameter editing is an Expert surface. Use Setup, Ports, Receiver, Outputs, and Power for routine workflow changes first.</p>
        </div>

        {resetToDefaultsSlot ? (
          <div className="parameter-reset-row" data-testid="parameters-reset-row">
            {resetToDefaultsSlot}
          </div>
        ) : null}

        <div className="parameter-toolbar">
          <input
            data-testid="parameter-search-input"
            aria-label="Search parameters"
            value={parameterSearch}
            onChange={(event) => setParameterSearch(event.target.value)}
            placeholder="Search parameters (e.g. ARMING_*, *VOLT*)"
          />
          {/* Fuzzy search finds a name you half-remember; it also returns
            * neighbours you did not ask for. This is the operator saying
            * "only what I typed" -- and it is a checkbox rather than a mode
            * switch because the useful move is toggling it against the same
            * query. Wildcards are literal either way, so the box has no
            * effect on a query containing * or ?. */}
          <label
            className="parameter-show-changed"
            title="Match the typed text literally (substring of the name or label) instead of fuzzily. Wildcard searches are literal either way."
          >
            <input
              type="checkbox"
              data-testid="parameter-exact-search-toggle"
              checked={parameterExactSearch}
              onChange={(event) => setParameterExactSearch(event.target.checked)}
            />
            <span>Exact match</span>
          </label>
          <select
            data-testid="parameter-category-filter"
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {formatCategoryLabel(category)}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="parameter-refresh-button"
            style={buttonStyle()}
            onClick={() => void handleRefreshParameters()}
            disabled={refreshDisabled}
            title="Pull the parameter list fresh from the flight controller."
          >
            Refresh
          </button>
          {/* The separate Fetch/Refresh-defaults button is gone. Fetching
            * defaults was never a goal in itself — it existed only so this
            * filter could work, so asking for it as a prerequisite step made the
            * operator do the app's bookkeeping. Ticking the box now fetches on
            * demand (see handleToggleShowOnlyNonDefault) and the label reports
            * progress inline. */}
          <label
            className="parameter-show-changed"
            title={
              nonDefaultParamIds
                ? 'Show only params that differ from their firmware default.'
                : 'Show only params that differ from their firmware default. Fetches the defaults from the FC on first use (needs ArduPilot 4.5+).'
            }
          >
            <input
              type="checkbox"
              data-testid="parameter-show-changed-toggle"
              checked={showOnlyNonDefault}
              onChange={handleToggleShowOnlyNonDefault}
              disabled={fetchDefaultsBusy || refreshDisabled}
            />
            <span>
              {fetchDefaultsBusy
                ? 'Fetching defaults…'
                : `Show only changed${nonDefaultParamIds ? ` (${nonDefaultParamIds.size})` : ''}`}
            </span>
          </label>
        </div>

        <div className="parameter-review">
          <input
            ref={parameterBackupInputRef}
            className="parameter-backup-input"
            aria-label="Import parameter backup file"
            type="file"
            accept="application/json,.json,.param,.parm,.params,text/plain"
            onChange={(event) => void handleImportParameterBackup(event)}
          />
          <div className="parameter-review__summary">
            <div className="parameter-review__stats">
              <StatusBadge tone={parameterDraftSummary.stagedCount > 0 ? 'warning' : 'neutral'}>
                {parameterDraftSummary.stagedCount} staged
              </StatusBadge>
              <StatusBadge tone={parameterDraftSummary.invalidCount > 0 ? 'danger' : 'neutral'}>
                {parameterDraftSummary.invalidCount} invalid
              </StatusBadge>
              <p className="parameter-review__hint">
                {parameterDraftSummary.totalEntries === 0
                  ? 'Edit values below to stage local drafts before writing anything to the controller.'
                  : parameterDraftSummary.invalidCount > 0
                    ? 'Fix or discard invalid drafts before applying the full staged set.'
                    : parameterDraftSummary.stagedCount > 0
                      ? 'Review the staged diff below, then apply individual rows or the whole set.'
                      : 'Current drafts match the live controller values and will not write anything.'}
              </p>
            </div>

            <div className="button-row">
              {/* One Export control — pick the format on click (field request:
               *  the old side-by-side "Export" + "Export Legacy…" read as two
               *  competing buttons). ArduConfigurator JSON keeps full metadata
               *  and round-trips through Import Backup; the two ground-station
               *  formats are for handing the file to Mission Planner / QGC.
               *  Controlled value="" resets to the placeholder after each pick
               *  so it reads as a one-shot action, not a persistent mode. */}
              <select
                data-testid="export-parameter-backup"
                className="export-format-select"
                style={buttonStyle('primary')}
                value=""
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                title="Export the current parameters — pick a format. ArduConfigurator JSON keeps full metadata and round-trips through Import Backup; Mission Planner / QGroundControl are for handing the file to those ground stations."
                onChange={(event) => {
                  const format = event.target.value
                  if (format === 'json') handleExportParameterBackup()
                  else if (format === 'parm') handleExportParameterBackupAsParm()
                  else if (format === 'params') handleExportParameterBackupAsParams()
                }}
              >
                <option value="" disabled>
                  Export…
                </option>
                <option value="json">ArduConfigurator JSON</option>
                <option value="parm">Mission Planner (.parm)</option>
                <option value="params">QGroundControl (.params)</option>
              </select>
              {/* JSON only: .parm/.params carry no vehicle, firmware or
                  timestamp, and a backup filed beside a flight is worth far more
                  with that context intact. */}
              <UploadToLogServerButton
                available={artifactUpload.available}
                serverUrl={artifactUpload.serverUrl}
                status={artifactUpload.status}
                onUpload={handleUploadParameterBackup}
                defaultFileName={parameterBackupUploadTarget.fileName}
                folder={parameterBackupUploadTarget.folder}
                label="this parameter backup"
                testId="upload-parameter-backup-button"
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
              />
              <fieldset className="parameter-import-exclusions" data-testid="parameter-export-exclusions">
                <legend>Skip on export</legend>
                {([
                  { key: 'calibration', label: 'Calibration', title: 'Leave compass/accel/gyro offsets, scales, and AHRS board-level trims (per-airframe values) out of the backup.' },
                  { key: 'stream-rates', label: 'Stream rates', title: 'Leave the SRn_* MAVLink telemetry stream-rate group out of the backup.' },
                  { key: 'mission', label: 'Mission', title: 'Leave the MIS_* mission parameters out of the backup.' }
                ] as const).map((option) => (
                  <label key={option.key} className="parameter-import-exclusions__item" title={option.title}>
                    <input
                      type="checkbox"
                      data-testid={`param-export-exclude-${option.key}`}
                      checked={parameterExportExclusions[option.key]}
                      onChange={() => handleToggleParameterExportExclusion(option.key)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <button
                data-testid="import-parameter-backup"
                style={buttonStyle()}
                onClick={handleOpenParameterBackup}
                disabled={busyAction !== undefined || snapshot.parameters.length === 0}
                title="Import any ArduConfigurator JSON, Mission Planner .parm, or QGroundControl .params file."
              >
                Import Backup
              </button>
              <fieldset className="parameter-import-exclusions" data-testid="parameter-import-exclusions">
                <legend>Skip on import</legend>
                {([
                  { key: 'calibration', label: 'Calibration', title: 'Skip compass/accel/gyro offsets, scales, and AHRS board-level trims — values you re-measure per airframe.' },
                  { key: 'stream-rates', label: 'Stream rates', title: 'Skip the SRn_* MAVLink telemetry stream-rate group.' },
                  { key: 'mission', label: 'Mission', title: 'Skip the MIS_* mission parameters.' }
                ] as const).map((option) => (
                  <label key={option.key} className="parameter-import-exclusions__item" title={option.title}>
                    <input
                      type="checkbox"
                      data-testid={`param-import-exclude-${option.key}`}
                      checked={parameterImportExclusions[option.key]}
                      onChange={() => handleToggleParameterImportExclusion(option.key)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <button
                style={buttonStyle('primary')}
                onClick={() => void handleApplyAllParameterDrafts()}
                disabled={busyAction !== undefined || !canApplyAllDraftParameters}
              >
                {busyAction === 'param:apply-all' ? applyAllBusyLabel : `Apply All (${stagedParameterDrafts.length})`}
              </button>
              <button
                style={buttonStyle()}
                onClick={handleDiscardAllParameterDrafts}
                disabled={busyAction !== undefined || parameterDraftSummary.totalEntries === 0}
              >
                Discard All
              </button>
            </div>
          </div>

          {/* Proactively explain a disabled "Apply All": the most common cause on
              real hardware is an accelerometer/compass calibration left running,
              which blocks every write. Surface the reason BEFORE the operator
              clicks so it's obvious why nothing writes (and to cancel it). */}
          {stagedParameterDrafts.length > 0 && !canApplyAllDraftParameters && parameterApplyBlockedReason(snapshot) ? (
            <div className="parameter-review__notice" data-testid="parameter-apply-blocked" role="alert">
              <StatusBadge tone="warning">writes blocked</StatusBadge>
              <p>{parameterApplyBlockedReason(snapshot)}</p>
            </div>
          ) : null}

          {parameterNotice ? (
            <div className="parameter-review__notice" data-testid="parameter-notice">
              <StatusBadge tone={parameterNotice.tone}>{parameterNotice.tone}</StatusBadge>
              <p>{parameterNotice.text}</p>
            </div>
          ) : null}

          {rebootRequiredDrafts.length > 0 ? (
            <div className="parameter-follow-up parameter-follow-up--warning">
              <StatusBadge tone="warning">reboot</StatusBadge>
              <p>
                {rebootRequiredDrafts.length} staged change(s) are marked as reboot-required if applied. Plan to reboot and refresh the
                parameter snapshot before continuing setup.
              </p>
            </div>
          ) : null}

	          {parameterFollowUp ? (
	            <div
	              className="parameter-follow-up"
	              ref={parameterFollowUp.requiresReboot ? rebootFollowUpRef : null}
	            >
	              <StatusBadge tone={parameterFollowUp.requiresReboot ? 'warning' : 'neutral'}>
	                {parameterFollowUp.requiresReboot ? 'reboot' : 'refresh'}
	              </StatusBadge>
	              <p>{parameterFollowUp.text}</p>
	              {parameterFollowUp.requiresReboot ? (
	                <button
	                  type="button"
	                  data-testid="parameter-follow-up-reboot"
	                  style={buttonStyle()}
	                  disabled={busyAction !== undefined || snapshot.connection.kind !== 'connected'}
	                  onClick={handleRequestReboot}
	                >
	                  {busyAction === 'reboot-autopilot' ? 'Rebooting…' : 'Request Reboot'}
	                </button>
	              ) : (
	                <small>Use the header session strip to complete the pending refresh.</small>
	              )}
	            </div>
	          ) : null}

          {/* An import used to stage every differing value the moment the file
            * was read, turning "let me look at this backup" into a pending write
            * of hundreds of parameters. It is held unstaged now, and this is the
            * prominent way to take it — the operator can also stage individual
            * rows from the source fields instead. */}
          {pendingParameterImport ? (
            <div className="parameter-import-prompt" data-testid="parameter-import-prompt" role="status">
              <div>
                <strong>
                  {pendingParameterImport.changedCount} value
                  {pendingParameterImport.changedCount === 1 ? '' : 's'} read from{' '}
                  {pendingParameterImport.fileName}
                </strong>
                <small>Nothing is staged yet. Staging only queues the writes — you still review and Apply All.</small>
              </div>
              <div className="parameter-import-prompt__actions">
                <button
                  type="button"
                  data-testid="parameter-import-stage-all"
                  style={buttonStyle('primary')}
                  onClick={onStagePendingParameterImport}
                  disabled={busyAction !== undefined || pendingParameterImport.changedCount === 0}
                >
                  Stage all ({pendingParameterImport.changedCount})
                </button>
                <button
                  type="button"
                  data-testid="parameter-import-dismiss"
                  style={buttonStyle()}
                  onClick={onDismissPendingParameterImport}
                  disabled={busyAction !== undefined}
                >
                  Discard import
                </button>
              </div>
            </div>
          ) : null}

          {/* Per-row and per-group control over the import, using the same
            * grouped-diff shape as the staged review and the Snapshots restore
            * preview. */}
          {pendingParameterImport && pendingImportDiff && pendingImportDiff.groups.length > 0 ? (
            <div className="parameter-diff-grid" data-testid="parameter-import-preview">
              {pendingImportDiff.groups.map((group) => (
                <section key={`import:${group.category}`} className="parameter-diff-group">
                  <header>
                    <strong>{formatCategoryLabel(group.category)}</strong>
                    <span>{group.entries.length} to stage</span>
                    <ParameterDiffGroupActions
                      actions={[
                        {
                          label: 'Stage group',
                          testId: `parameter-import-stage-group-${group.category}`,
                          onClick: () => onStagePendingParameterImportSubset(paramIdsForGroup(group)),
                          disabled: busyAction !== undefined,
                          title: `Stage all ${group.entries.length} ${formatCategoryLabel(group.category)} value(s) from this import.`
                        },
                        {
                          label: 'Drop group',
                          testId: `parameter-import-drop-group-${group.category}`,
                          onClick: () => onDropPendingParameterImportEntries(paramIdsForGroup(group)),
                          disabled: busyAction !== undefined,
                          title: `Drop all ${group.entries.length} ${formatCategoryLabel(group.category)} value(s) from this import.`
                        }
                      ]}
                    />
                  </header>

                  {group.entries.map((draft) => (
                    <div key={draft.id} className="parameter-diff-item">
                      <ParameterDiffIdentity draft={draft} />
                      <span className="parameter-diff-values">
                        {formatParameterDraftValue(draft.definition, draft.currentValue)}
                        {' → '}
                        {formatParameterDraftValue(draft.definition, draft.nextValue)}
                      </span>
                      <span className="parameter-diff-delta">
                        {formatParameterDelta(draft.delta, draft.definition?.unit)}
                      </span>
                      <div className="parameter-diff-actions">
                        <button
                          type="button"
                          style={buttonStyle()}
                          data-testid={`parameter-import-stage-${draft.id}`}
                          onClick={() => onStagePendingParameterImportSubset([draft.id])}
                          disabled={busyAction !== undefined}
                          title={`Stage ${draft.id} from this import.`}
                        >
                          Stage
                        </button>
                        <button
                          type="button"
                          style={buttonStyle()}
                          data-testid={`parameter-import-drop-${draft.id}`}
                          onClick={() => onDropPendingParameterImportEntries([draft.id])}
                          disabled={busyAction !== undefined}
                          title={`Drop ${draft.id} from this import (keeps the live value).`}
                        >
                          Drop
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : null}

          {parameterDraftSummary.stagedCategories.length > 0 ? (
            <small className="parameter-review__hint">
              Categories in review: {parameterDraftSummary.stagedCategories.map((categoryId) => formatCategoryLabel(categoryId)).join(', ')}
            </small>
          ) : null}

          {stagedParameterGroups.length > 0 ? (
            <div className="parameter-diff-bulk" data-testid="parameter-diff-bulk">
              <label className="parameter-diff-bulk__all">
                <input
                  type="checkbox"
                  data-testid="parameter-diff-select-all"
                  checked={allDraftsSelected}
                  onChange={(event) => setAllDraftsSelected(event.target.checked)}
                  disabled={busyAction !== undefined}
                />
                <span>Select all</span>
              </label>
              <button
                type="button"
                data-testid="parameter-diff-drop-selected"
                style={buttonStyle()}
                onClick={handleDropSelectedDrafts}
                disabled={busyAction !== undefined || selectedDraftIds.size === 0}
                title="Drop every selected staged change. Shift-click checkboxes to select a range."
              >
                Drop selected ({selectedDraftIds.size})
              </button>
              {hiddenStagedCount > 0 ? (
                <small data-testid="parameter-diff-hidden-count">
                  {hiddenStagedCount} staged row{hiddenStagedCount === 1 ? '' : 's'} hidden by the search
                </small>
              ) : null}
            </div>
          ) : null}

          {parameterDraftSummary.invalidCount > 0 ? (
            <a
              href="#parameter-invalid-grid"
              data-testid="parameter-review-invalid-callout"
              onClick={(event) => {
                // Take over from the native anchor jump, which ignores the
                // sticky header and leaves the invalid block above the viewport.
                event.preventDefault()
                scrollToReviewTarget(invalidDiffGridRef.current)
              }}
              role="alert"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '10px 14px',
                marginBottom: '12px',
                borderRadius: '8px',
                border: '1px solid var(--danger, #d9534f)',
                background: 'rgba(217, 83, 79, 0.12)',
                color: 'inherit',
                textDecoration: 'none'
              }}
            >
              <strong style={{ color: 'var(--danger, #ff6b6b)' }}>
                {parameterDraftSummary.invalidCount} invalid draft
                {parameterDraftSummary.invalidCount === 1 ? '' : 's'} blocking Apply All
              </strong>
              <span>Override, fix, or drop these first — jump to them ↓</span>
            </a>
          ) : null}

          {visibleStagedGroups.length > 0 ? (
            <div ref={stagedDiffGridRef} className="parameter-diff-grid" id="parameter-diff-grid" data-testid="parameter-diff-grid">
              {visibleStagedGroups.map((group) => (
                <section key={group.category} className="parameter-diff-group">
                  <header>
                    <strong>{formatCategoryLabel(group.category)}</strong>
                    <span>{group.entries.filter((entry) => entry.status === 'staged').length} staged</span>
                    {/* Drop a whole category at once. The review is already
                      * grouped by category, so that is the unit an operator
                      * thinks in when abandoning part of a change set. Shares the
                      * group-action component with the Snapshots restore preview
                      * so both review surfaces behave identically. */}
                    <ParameterDiffGroupActions
                      actions={[
                        {
                          label: 'Drop group',
                          testId: `parameter-diff-drop-group-${group.category}`,
                          onClick: () => handleDropDraftGroup(paramIdsForGroup(group)),
                          disabled: busyAction !== undefined || group.entries.length === 0,
                          title: `Drop all ${group.entries.length} staged change(s) in ${formatCategoryLabel(group.category)}.`
                        }
                      ]}
                    />
                  </header>

                  {group.entries.map((draft) => {
                    // Inline editor so a staged value can be nudged (e.g.
                    // FLTMODE_CH 8 → 6) without leaving the review list:
                    // select when the param has options (enum /
                    // channel-selector), number input otherwise. Uses the
                    // same setDraft contract as the source field, so
                    // editing here is identical to editing in the source
                    // tab.
                    const options = draft.definition?.options
                    // Bitmask options are BIT INDICES, not exclusive values
                    // — an exclusive <select> over them would write the
                    // index instead of the mask. Bitmask rows edit the raw
                    // value and show the decoded bits underneath instead.
                    const isBitmask = draft.definition?.bitmask === true
                    const inputId = `parameter-diff-edit-${draft.id}`
                    const currentRawValue = editedValues[draft.id] ?? String(draft.nextValue)
                    // 'unchanged' = the operator edited this back to the live
                    // value. Keep the row (so the input never vanishes mid-edit)
                    // but render it muted — it won't write.
                    const isUnchanged = draft.status === 'unchanged'
                    const importedValue = importedDraftOrigins[draft.id]
                    return (
                    <div
                      key={draft.id}
                      className={`parameter-diff-item parameter-diff-item--selectable${isUnchanged ? ' parameter-diff-item--unchanged' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="parameter-diff-item__select"
                        data-testid={`parameter-diff-select-${draft.id}`}
                        checked={selectedDraftIds.has(draft.id)}
                        aria-label={`Select ${draft.id} for bulk drop`}
                        title="Select for bulk drop. Shift-click selects a range."
                        disabled={busyAction !== undefined}
                        onClick={(event) => handleDraftSelectionClick(draft.id, event.shiftKey)}
                        onChange={() => {}}
                      />
                      <ParameterDiffIdentity draft={draft} />
                      <span className="parameter-diff-values">
                        <em>Current:</em> {formatParameterDraftValue(draft.definition, draft.currentValue)}
                        {' → '}
                        {/* What the imported file asked for, shown whenever this
                          * draft came from an import. The editor below is free
                          * to be nudged afterwards — including back to the live
                          * value, where the row reads "matches current" — and
                          * without this the imported number is gone from the
                          * screen with no way to recover it. Mission Planner
                          * shows the imported value for the same reason. */}
                        {importedValue !== undefined ? (
                          <>
                            <em>Import:</em>{' '}
                            <span data-testid={`parameter-diff-import-${draft.id}`}>
                              {formatParameterDraftValue(draft.definition, Number(importedValue))}
                            </span>
                            {' → '}
                          </>
                        ) : null}
                        <em>New:</em>{' '}
                        {/* Bitmask params get the same per-bit popover the
                          * parameter row uses. They used to fall through to the
                          * raw number input here — the one place a staged
                          * bitmask is actually reviewed — so RC_OPTIONS could
                          * not be inspected or toggled bit by bit without
                          * leaving the review and finding the row below. */}
                        {isBitmask && (draft.definition?.options?.length ?? 0) > 0 && draft.definition ? (
                          <ScopedBitmaskPopover
                            parameter={{
                              id: draft.id,
                              value: draft.currentValue ?? 0,
                              definition: draft.definition,
                              index: 0,
                              count: 0
                            }}
                            liveValue={draft.currentValue}
                            editedValues={editedValues}
                            draftStatusById={draftStatusMap}
                            onChange={setDraft}
                          />
                        ) : options && options.length > 0 && !isBitmask ? (
                          <select
                            id={inputId}
                            data-testid={`parameter-diff-edit-${draft.id}`}
                            className="parameter-diff-edit"
                            value={currentRawValue}
                            onChange={(event) => setDraft(draft.id, event.target.value)}
                            disabled={busyAction !== undefined}
                            aria-label={`Edit staged value for ${draft.id}`}
                          >
                            {options.map((option) => (
                              <option key={option.value} value={String(option.value)}>
                                {option.label} ({option.value})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={inputId}
                            data-testid={`parameter-diff-edit-${draft.id}`}
                            className="parameter-diff-edit"
                            type="number"
                            step="any"
                            value={currentRawValue}
                            onChange={(event) => setDraft(draft.id, event.target.value)}
                            disabled={busyAction !== undefined}
                            aria-label={`Edit staged value for ${draft.id}`}
                          />
                        )}
                      </span>
                      <span className="parameter-diff-delta">
                        {isUnchanged ? 'matches current — won’t write' : formatParameterDelta(draft.delta, draft.definition?.unit)}
                      </span>
                      {/* Per-row Discard so the operator can deselect a
                       *  single staged change from the Apply All set
                       *  without leaving the Show Changes view. Apply All
                       *  consumes only what's still staged after the
                       *  discards. */}
                      <button
                        type="button"
                        data-testid={`parameter-diff-discard-${draft.id}`}
                        className="parameter-diff-item__discard"
                        style={buttonStyle()}
                        onClick={() => handleDiscardParameterDraft(draft.id)}
                        disabled={busyAction !== undefined}
                        title={`Drop the staged change to ${draft.id} (keeps the live FC value as-is).`}
                      >
                        Drop
                      </button>
                    </div>
                  )})}
                </section>
              ))}
            </div>
          ) : null}

          {invalidParameterGroups.length > 0 ? (
            <div ref={invalidDiffGridRef} className="parameter-diff-grid parameter-diff-grid--invalid" id="parameter-invalid-grid">
              {invalidParameterGroups.map((group) => (
                <section key={`invalid:${group.category}`} className="parameter-diff-group parameter-diff-group--invalid">
                  <header>
                    <strong>{formatCategoryLabel(group.category)}</strong>
                    <span>{group.entries.length} invalid</span>
                    {/* Bulk override, matching the Snapshots restore preview — a
                      * cross-board import blocked by a handful of metadata-range
                      * rejections should not need a click per row. Counts only
                      * rows an override can actually rescue, so the number never
                      * over-promises. */}
                    <ParameterDiffGroupActions
                      actions={[
                        ...(overridableGroupIds(group).length > 0
                          ? [
                              {
                                label: `Override all (${overridableGroupIds(group).length})`,
                                testId: `parameter-diff-override-group-${group.category}`,
                                onClick: () =>
                                  overridableGroupIds(group).forEach((paramId) =>
                                    handleToggleParameterEnumOverride(paramId)
                                  ),
                                disabled: busyAction !== undefined,
                                title: 'Override and write anyway for every rescuable value in this category.'
                              }
                            ]
                          : []),
                        {
                          label: 'Drop group',
                          testId: `parameter-diff-drop-invalid-group-${group.category}`,
                          onClick: () => handleDropDraftGroup(paramIdsForGroup(group)),
                          disabled: busyAction !== undefined || group.entries.length === 0,
                          title: `Drop all ${group.entries.length} invalid draft(s) in ${formatCategoryLabel(group.category)}.`
                        }
                      ]}
                    />
                  </header>

                  {group.entries.map((draft) => {
                    // Override available for any METADATA-driven validation
                    // mismatch: enum-mismatch AND min/max range violation.
                    // Non-numeric input ("Value must be numeric.") stays
                    // hard-invalid — that's a syntax problem, not a metadata
                    // disagreement the user can vouch for.
                    // Reads the core's `overridable` flag. This used to
                    // string-match the reason text the validator writes, so
                    // rewording a message in parameter-drafts.ts would have
                    // silently removed the Override button here while the
                    // Snapshots preview (which reads the flag) kept it.
                    return (
                      <ParameterDiffInvalidRow
                        key={draft.id}
                        draft={draft}
                        actions={
                          <>
                            {isOverridableInvalidEntry(draft) ? (
                              <button
                                type="button"
                                data-testid={`parameter-diff-override-${draft.id}`}
                                style={buttonStyle()}
                                onClick={() => handleToggleParameterEnumOverride(draft.id)}
                                disabled={busyAction !== undefined}
                                title="Treat this value as valid and let it write through — useful when the firmware accepts a value the metadata's documented range or enum doesn't yet include."
                              >
                                Override and write anyway
                              </button>
                            ) : null}
                            {/* Every invalid row offers Drop — same contract
                                as staged rows — so the operator can dismiss a
                                bad draft without first having to fix it. */}
                            <button
                              type="button"
                              data-testid={`parameter-diff-discard-${draft.id}`}
                              style={buttonStyle()}
                              onClick={() => handleDiscardParameterDraft(draft.id)}
                              disabled={busyAction !== undefined}
                              title={`Drop the invalid draft to ${draft.id} (clears the local edit; keeps the live FC value as-is).`}
                            >
                              Drop
                            </button>
                          </>
                        }
                      />
                    )
                  })}
                </section>
              ))}
            </div>
          ) : null}

          {/* When an enum override is active, the draft moves from the
           *  invalid list into the staged list above; the staged row gets
           *  a small badge so the operator remembers that THIS one was
           *  pushed through against the metadata's enum list and a Cancel
           *  override button to undo. */}
          {parameterEnumOverrides.size > 0 ? (
            <small className="parameter-review__hint">
              Overridden enum-mismatch drafts (writes anyway):{' '}
              {[...parameterEnumOverrides].map((paramId, index) => (
                <span key={paramId}>
                  {index > 0 ? ', ' : ''}
                  <button
                    type="button"
                    data-testid={`parameter-diff-cancel-override-${paramId}`}
                    className="parameter-review__hint-button"
                    onClick={() => handleToggleParameterEnumOverride(paramId)}
                    disabled={busyAction !== undefined}
                    title={`Cancel the override on ${paramId} and re-flag it as invalid.`}
                  >
                    {paramId} (cancel)
                  </button>
                </span>
              ))}
            </small>
          ) : null}
        </div>

        {/* Group-to-preset selection. Sits directly above the table because it
          * acts on the table's rows, and states the visible-rows-only rule
          * inline — the same rule the staged bulk drop follows. */}
        {onCreateUserPreset ? (
          <div className="parameter-preset-bulk" data-testid="parameter-preset-bulk">
            <label className="parameter-diff-bulk__all">
              <input
                type="checkbox"
                data-testid="parameter-preset-select-all"
                checked={allVisibleSelected}
                onChange={(event) => handleSelectAllVisible(event.target.checked)}
                disabled={busyAction !== undefined || displayedParameterIds.length === 0}
              />
              <span>Select all visible ({displayedParameterIds.length})</span>
            </label>
            <button
              type="button"
              data-testid="parameter-create-preset"
              style={buttonStyle('primary')}
              onClick={handleOpenCreatePreset}
              disabled={busyAction !== undefined || visibleSelectedParamIds.length === 0}
              title="Save the selected parameters' current values as a reusable preset. Reads only — nothing is written to the aircraft."
            >
              Create preset ({visibleSelectedParamIds.length})
            </button>
            <button
              type="button"
              data-testid="parameter-preset-clear-selection"
              style={buttonStyle()}
              onClick={() => {
                setPresetSelection(new Set())
                presetSelectionAnchorRef.current = null
              }}
              disabled={presetSelection.size === 0}
            >
              Clear selection
            </button>
            <small>
              Tick rows to build a preset. Shift-click selects a range. Select all and Create preset act on the rows currently visible,
              so the search and category filters can never pull in a row you cannot see.
              {hiddenSelectedCount > 0 ? (
                <>
                  {' '}
                  <strong data-testid="parameter-preset-hidden-count">
                    {hiddenSelectedCount} selected row{hiddenSelectedCount === 1 ? '' : 's'} hidden by the current filter
                  </strong>{' '}
                  — they stay selected and return when you clear it.
                </>
              ) : null}
            </small>
          </div>
        ) : null}

        <div className="parameter-table">
          <div className="parameter-row parameter-row--header">
            <span>Parameter</span>
            <span>Description</span>
            <span>Default</span>
            <span>Current</span>
            <span>Draft</span>
            <span>Actions</span>
          </div>
          {displayedParameters.map((parameter) => {
            const draft = parameterDraftById.get(parameter.id)
            // Prefer the upstream-enriched catalog definition so the raw
            // parameter table shows real descriptions/units/categories for the
            // whole tree, not just curated params.
            const definition = metadataCatalog.parameters[parameter.id] ?? parameter.definition
            // Row state reads as colour rather than as a button tint: yellow
            // staged (typed, not written), green just-written (the controller
            // confirmed it), red invalid. A staged row used to be a barely
            // perceptible gradient, so "have my edits gone in?" was not
            // answerable at a glance.
            const rowClassName =
              draft?.status === 'staged'
                ? 'parameter-row parameter-row--staged'
                : draft?.status === 'invalid'
                  ? 'parameter-row parameter-row--invalid'
                  : recentlyWrittenParamIds.has(parameter.id)
                    ? 'parameter-row parameter-row--written'
                    : 'parameter-row'

            const isExpanded = selectedParameterId === parameter.id
            return (
              <Fragment key={parameter.id}>
              <div
                className={`${rowClassName}${isExpanded ? ' parameter-row--selected parameter-row--expanded' : ''}`}
                // Lets the edit-time scroll compensation above find this row
                // again after the commit, without threading a ref per row
                // through the (unbounded) parameter list.
                data-param-row={parameter.id}
                // Click the row to expand its detail; toggle to collapse. The
                // Draft + Actions cells stop propagation so editing/clicking a
                // control never collapses the row under the operator.
                onClick={() => setSelectedParameterId(isExpanded ? undefined : parameter.id)}
              >
                <span className="parameter-row__name">
                  {/* Lives inside the name cell rather than as a seventh grid
                    * column so the table's column template (and every surface
                    * that styles it) is untouched. stopPropagation keeps a
                    * selection click from also expanding the row detail. */}
                  {onCreateUserPreset ? (
                    <input
                      type="checkbox"
                      className="parameter-row__select"
                      data-testid={`parameter-preset-select-${parameter.id}`}
                      checked={presetSelection.has(parameter.id)}
                      aria-label={`Select ${parameter.id} for a preset`}
                      title="Select for Create preset. Shift-click selects a range."
                      disabled={busyAction !== undefined}
                      onClick={(event) => {
                        event.stopPropagation()
                        handlePresetSelectionClick(parameter.id, event.shiftKey)
                      }}
                      onChange={() => {}}
                    />
                  ) : null}
                  <span className="parameter-row__caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                  <span>
                    <strong>{parameter.id}</strong>
                    <small>{formatCategoryLabel(definition?.category)}</small>
                  </span>
                </span>
                <span>
                  {definition?.description ?? 'Metadata to be expanded from upstream ArduPilot bundles.'}
                  {definition?.unit ? <small>Unit: {definition.unit}</small> : null}
                </span>
                {/* Firmware default, from the FC's own param.pck. Blank until
                  * the defaults have been pulled — an empty cell says "not
                  * known", which is honest, where a guessed value would not
                  * be. */}
                <span className="parameter-row__default">
                  {(() => {
                    const defaultValue = parameterDefaults?.get(parameter.id)
                    if (defaultValue === undefined) {
                      return <small className="parameter-row__default-unknown">—</small>
                    }
                    return (
                      <>
                        <span>{formatParameterValue(defaultValue, definition?.unit)}</span>
                        {defaultValue === parameter.value ? null : (
                          <small className="parameter-row__default-differs">changed</small>
                        )}
                      </>
                    )
                  })()}
                </span>
                <span className="parameter-row__value">
                  <strong>{formatParameterValue(parameter.value, definition?.unit)}</strong>
                  {draft?.status === 'staged' ? (
                    <small>Delta {formatParameterDelta(draft.delta, definition?.unit)}</small>
                  ) : null}
                </span>
                <span
                  className="parameter-row__value"
                  // Editing must never COLLAPSE an expanded row (the control
                  // would vanish mid-edit), which is why this cell swallows the
                  // row click. But swallowing it also meant clicking into the
                  // editor on a COLLAPSED row did nothing except focus the
                  // input — so reaching for the value field never revealed the
                  // metadata detail, which is exactly when an operator wants to
                  // know the range and the enum meanings. Expand on the way in,
                  // never collapse on the way out.
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!isExpanded) {
                      setSelectedParameterId(parameter.id)
                    }
                  }}
                >
                  {definition?.bitmask === true && (definition.options?.length ?? 0) > 0 ? (
                    // Bitmask params edit as Mission-Planner-style per-bit
                    // checkboxes (each labelled with its bit meaning) instead
                    // of a raw number field. Compact collapsible popover so a
                    // long bit list doesn't blow out the row or overlap Apply.
                    <ScopedBitmaskPopover
                      parameter={{ ...parameter, definition }}
                      liveValue={parameter.value}
                      editedValues={editedValues}
                      draftStatusById={draftStatusMap}
                      onChange={setDraftKeepingRowInPlace}
                    />
                  ) : (
                    <input
                      type="number"
                      data-testid={`parameter-row-input-${parameter.id}`}
                      aria-label={`${parameter.id} value`}
                      value={editedValues[parameter.id] ?? String(parameter.value)}
                      onChange={(event) =>
                        setDraftKeepingRowInPlace(parameter.id, event.target.value)
                      }
                    />
                  )}
                  {draft ? (
                    <small className={`parameter-status-copy parameter-status-copy--${draft.status}`}>
                      {draft.status === 'staged'
                        ? `Staged ${formatParameterValue(draft.nextValue, parameter.definition?.unit)}`
                        : (draft.reason ?? '')}
                    </small>
                  ) : null}
                </span>
                <span onClick={(event) => event.stopPropagation()}>
                  <div className="parameter-actions">
                    {draft?.status === 'staged' ? (
                      <>
                        <button
                          style={buttonStyle('primary')}
                          onClick={() => void handleApplyParameterDraft(draft)}
                          disabled={busyAction !== undefined || !canApplyDraftParameters}
                        >
                          {busyAction === `param:${parameter.id}` ? 'Writing…' : 'Apply'}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() => handleDiscardParameterDraft(parameter.id)}
                          disabled={busyAction !== undefined}
                        >
                          Discard
                        </button>
                      </>
                    ) : draft ? (
                      <>
                        <StatusBadge tone={toneForParameterDraftStatus(draft.status)}>{draft.status}</StatusBadge>
                        <button
                          style={buttonStyle()}
                          onClick={() => handleDiscardParameterDraft(parameter.id)}
                          disabled={busyAction !== undefined}
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <span className="parameter-actions__idle">No local draft</span>
                    )}
                  </div>
                </span>
              </div>
              {isExpanded ? (
                <div className="parameter-row-detail" onClick={(event) => event.stopPropagation()}>
                  <ParameterDetail
                    parameter={parameter}
                    definition={definition}
                    alias={parameterAlias(parameter.id)}
                    editedValues={editedValues}
                    onChange={setDraftKeepingRowInPlace}
                    draftStatusById={draftStatusMap}
                    defaultValue={parameterDefaults?.get(parameter.id)}
                  />
                </div>
              ) : null}
              </Fragment>
            )
          })}
        </div>
        {displayedParameters.length === 0 ? <p className="parameter-empty-state">No parameters match the current filter.</p> : null}

        {createPresetOpen && onCreateUserPreset ? (
          <CreatePresetDialog
            params={createPresetParams}
            savedCount={presetKeptIds.length}
            name={presetName}
            onNameChange={setPresetName}
            description={presetDescription}
            onDescriptionChange={setPresetDescription}
            questions={createPresetQuestions}
            onToggleQuestion={handleToggleDependencyAnswer}
            showCellCount={presetAnsweredClasses.has('battery-pack')}
            cellCount={presetCellCount}
            onCellCountChange={setPresetCellCount}
            calibrationParamIds={presetCalibrationParamIds}
            rebootRequiredParamIds={presetDetection.rebootRequiredParamIds}
            unclassifiedCount={presetDetection.unclassifiedParamIds.length}
            onToggleParamExcluded={handleTogglePresetParamExcluded}
            onSave={handleSaveUserPreset}
            onCancel={() => setCreatePresetOpen(false)}
          />
        ) : null}
      </Panel>

  )
}
