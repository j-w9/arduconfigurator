// OSD editor state, extracted from App.tsx as part of its decomposition. Owns
// the currently-previewed screen, the copy/paste layout clipboard, the derived
// element matrix / preview-element / screen-option view models, and the
// drag-to-move + copy/paste handlers — everything the Osd view needs and
// nothing else does. Behavior-neutral lift of the original App() hooks (same
// order, same dependency arrays).

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

import type { ConfiguratorSnapshot, ParameterState } from '@arduconfig/ardupilot-core'

import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { formatRxRssi } from '../status-formatters'
import { OSD_ELEMENTS, OSD_SCREEN_NUMBERS, OSD_SCREEN_OPTION_SUFFIXES, type OsdScreenNumber } from '../osd-params'
import type { OsdElementMatrixRow, OsdPreviewElement, OsdScreenEnableEntry, OsdScreenOptionField } from '../views/Osd'
import type { ParameterDraftValues } from './use-parameter-drafts'
import type { ParameterNotice } from './use-parameter-feedback'

export interface UseOsdEditorParams {
  snapshot: ConfiguratorSnapshot
  osdParameterById: Map<string, ParameterState>
  editedValues: ParameterDraftValues
  setDraft: (paramId: string, value: string) => void
  setParameterNotice: Dispatch<SetStateAction<ParameterNotice | undefined>>
}

type CopiedOsdLayout =
  | { sourceScreen: OsdScreenNumber; cells: Record<string, { en?: number; x?: number; y?: number }> }
  | undefined

export interface UseOsdEditorResult {
  activeOsdScreen: OsdScreenNumber
  setActiveOsdScreen: Dispatch<SetStateAction<OsdScreenNumber>>
  copiedOsdLayout: CopiedOsdLayout
  osdScreenOptionFields: OsdScreenOptionField[]
  osdScreenEnableEntries: readonly OsdScreenEnableEntry[]
  osdElementMatrix: OsdElementMatrixRow[]
  osdPreviewElements: OsdPreviewElement[]
  handleOsdElementMove: (elementId: string, column: number, row: number) => void
  handleCopyOsdLayout: () => void
  handlePasteOsdLayout: () => void
}

export function useOsdEditor({
  snapshot,
  osdParameterById,
  editedValues,
  setDraft,
  setParameterNotice
}: UseOsdEditorParams): UseOsdEditorResult {
  const [activeOsdScreen, setActiveOsdScreen] = useState<OsdScreenNumber>(1)

  // Per-screen "Screen Options" for the currently-previewed screen. ENABLE
  // renders as a select (enabled/disabled); the rest as numbers.
  const osdScreenOptionFields = useMemo<OsdScreenOptionField[]>(
    () =>
      OSD_SCREEN_OPTION_SUFFIXES.flatMap((suffix) => {
        const parameter = osdParameterById.get(`OSD${activeOsdScreen}_${suffix}`)
        if (!parameter) {
          return []
        }
        return [{ parameter, liveValue: parameter.value, kind: suffix === 'ENABLE' ? 'select' : 'number' }]
      }),
    [osdParameterById, activeOsdScreen]
  )

  // Per-screen OSD<n>_ENABLE lookup for the matrix column headers, so the
  // operator can enable OSD2/3/4 directly from the screens row instead of
  // having to switch the preview to that screen first to reach the Screen
  // Options panel. When the FC's build omits a screen entirely the parameter
  // is absent and the column shows a 'not supported' badge.
  const osdScreenEnableEntries = useMemo<readonly OsdScreenEnableEntry[]>(
    () =>
      OSD_SCREEN_NUMBERS.map((screen) => ({
        screen,
        parameter: osdParameterById.get(`OSD${screen}_ENABLE`)
      })),
    [osdParameterById]
  )

  // Per-element enable toggles. Each toggle drives an OSD1_<id>_EN
  // parameter and rides the same staged-draft / Save-OSD path as the
  // backend selectors above. Elements without a corresponding EN param
  // on the connected FC are dropped — toggling a non-existent
  // parameter would just stage a write the autopilot will refuse.
  // Betaflight-style matrix: each element row carries a checkbox per OSD screen
  // (OSD1-4), so the operator assigns which screen shows which element. The
  // preview is driven separately by activeOsdScreen (a dropdown).
  const osdElementMatrix = useMemo<OsdElementMatrixRow[]>(() => {
    return OSD_ELEMENTS.flatMap((element) => {
      const cells = OSD_SCREEN_NUMBERS.map((screen) => {
        const parameter = osdParameterById.get(`OSD${screen}_${element.id}_EN`)
        if (!parameter) {
          return undefined
        }
        const liveValue = typeof parameter.value === 'number' && Number.isFinite(parameter.value)
          ? Math.round(parameter.value)
          : undefined
        return { screen: screen as number, parameterId: parameter.id, liveValue }
      }).filter((cell): cell is { screen: number; parameterId: string; liveValue: number | undefined } => cell !== undefined)
      if (cells.length === 0) {
        return []
      }
      return [{ elementId: element.id, label: element.label, cells }]
    })
  }, [osdParameterById])

  // OSD1_*_EN/X/Y are catalog parameters that the firmware writes through
  // its own OSD page registration. The preview HUD reads them from the live
  // snapshot so the rendered overlay reflects whatever layout the FC
  // currently has configured. EN === 1 makes the element visible; X/Y are
  // clamped to the 30x16 character grid.
  const osdPreviewElements = useMemo<OsdPreviewElement[]>(() => {
    // Read X/Y prefer-edit so the preview moves in real-time while the
    // user drags. EN stays snapshot-driven — hiding an element from the
    // toggle checklist commits the same way as before, but the preview
    // shouldn't disappear from under a drag.
    const readNumber = (paramId: string): number | undefined => {
      const edited = editedValues[paramId]
      if (edited !== undefined && edited !== '') {
        const parsed = Number.parseFloat(edited)
        if (Number.isFinite(parsed)) {
          return Math.round(parsed)
        }
      }
      const raw = selectParameterById(snapshot, paramId)?.value
      if (raw === undefined || !Number.isFinite(raw)) {
        return undefined
      }
      return Math.round(raw)
    }
    const battery = snapshot.liveVerification.batteryTelemetry
    const attitude = snapshot.liveVerification.attitudeTelemetry
    const position = snapshot.liveVerification.globalPosition
    const headingDeg = position.headingDeg ?? attitude.yawDeg
    const headingNumber = headingDeg !== undefined
      ? Math.round(((headingDeg % 360) + 360) % 360)
      : undefined
    const altitudeM = position.relativeAltitudeM ?? position.altitudeM
    const formatNumber = (value: number | undefined, digits = 0, fallback = '0'): string => {
      if (value === undefined || !Number.isFinite(value)) {
        return fallback
      }
      return value.toFixed(digits)
    }
    // Preview text per element. Entries with live data render the
    // formatted live value; the rest fall back to a short placeholder
    // ("WIND" / "SATS") so the operator can still see where the
    // element would land on the overlay when it eventually has data.
    const elementTexts: Record<string, string> = {
      BAT_VOLT: `${formatNumber(battery.voltageV, 1, '0.0')}V`,
      CURRENT: `${formatNumber(battery.currentA, 1, '0.0')}A`,
      BATUSED: 'BATUSED',
      RSSI: `RSSI ${formatRxRssi(snapshot.liveVerification.rcInput.rssi)}`,
      ALTITUDE: `ALT ${formatNumber(altitudeM, 1, '0.0')}m`,
      GSPEED: `${formatNumber(position.groundSpeedMs, 0, '0')}m/s`,
      ASPEED: 'ASPD',
      VSPEED: 'VSPD',
      HEADING: `HDG ${headingNumber ?? 0}°`,
      COMPASS: 'N · · E · · S · · W',
      WIND: 'WIND',
      THROTTLE: `THR ${formatNumber(snapshot.liveVerification.rcInput.channels[2], 0, '0')}us`,
      FLTMODE: snapshot.vehicle?.flightMode ?? 'STABILIZE',
      MESSAGE: 'MSG',
      HOME: 'HOME',
      HOMEDIST: 'HDIST',
      HOMEDIR: 'HDIR',
      HORIZON: '[H]',
      SATS: 'SAT',
      HDOP: 'HDOP',
      WAYPOINT: 'WP',
      DIST: 'DIST',
      TEMP: 'TEMP',
      ATEMP: 'ATMP',
      CALLSIGN: 'CALL'
    }
    // Enabled elements whose X/Y the FC didn't report (advanced elements in the
    // demo, or a half-configured real layout) still need to appear on the
    // overlay. Lay them out at sequential default cells — stacked in centre
    // columns, wrapping every 14 rows — so the operator sees them and can drag
    // them into place (which writes real X/Y). A real FC reports X/Y for every
    // enabled element, so this fallback only fills genuine gaps.
    let defaultSlot = 0
    return Object.entries(elementTexts).flatMap(([elementId, text]) => {
      const enabled = readNumber(`OSD${activeOsdScreen}_${elementId}_EN`)
      if (enabled !== 1) {
        return []
      }
      let column = readNumber(`OSD${activeOsdScreen}_${elementId}_X`)
      let row = readNumber(`OSD${activeOsdScreen}_${elementId}_Y`)
      if (column === undefined || row === undefined) {
        column = 9 + Math.floor(defaultSlot / 14) * 7
        row = 1 + (defaultSlot % 14)
        defaultSlot += 1
      }
      return [{
        id: elementId,
        text,
        column: Math.max(0, Math.min(29, column)),
        row: Math.max(0, Math.min(15, row))
      }]
    })
  }, [
    snapshot.parameters,
    snapshot.liveVerification.batteryTelemetry,
    snapshot.liveVerification.attitudeTelemetry,
    snapshot.liveVerification.globalPosition,
    snapshot.liveVerification.rcInput.channels,
    snapshot.liveVerification.rcInput.rssi,
    snapshot.vehicle?.flightMode,
    editedValues,
    activeOsdScreen
  ])

  // Drag-and-drop handler: fires while the user repositions an element
  // on the preview. Stages drafts for the matching X/Y params so the
  // preview reflects the move in real time and Save OSD picks the
  // change up alongside backend selectors + EN toggles. Uses the
  // currently-selected screen number so dragging on OSD2's layout
  // doesn't touch OSD1's params.
  const handleOsdElementMove = useCallback((elementId: string, column: number, row: number) => {
    setDraft(`OSD${activeOsdScreen}_${elementId}_X`, String(column))
    setDraft(`OSD${activeOsdScreen}_${elementId}_Y`, String(row))
  }, [setDraft, activeOsdScreen])

  // Copy/Paste an entire OSD screen layout between screens (Mission Planner
  // parity). Copy snapshots the source screen's EN/X/Y for every element; Paste
  // stages them onto the active screen as drafts (Save OSD then writes). Pasting
  // values that already match the live screen is a no-op (the draft model marks
  // them unchanged), so paste-onto-self stages nothing.
  const [copiedOsdLayout, setCopiedOsdLayout] = useState<CopiedOsdLayout>(undefined)

  const handleCopyOsdLayout = useCallback(() => {
    const cells: Record<string, { en?: number; x?: number; y?: number }> = {}
    for (const element of OSD_ELEMENTS) {
      cells[element.id] = {
        en: readRoundedParameter(snapshot, `OSD${activeOsdScreen}_${element.id}_EN`),
        x: readRoundedParameter(snapshot, `OSD${activeOsdScreen}_${element.id}_X`),
        y: readRoundedParameter(snapshot, `OSD${activeOsdScreen}_${element.id}_Y`)
      }
    }
    setCopiedOsdLayout({ sourceScreen: activeOsdScreen, cells })
    setParameterNotice({
      tone: 'success',
      text: `Copied OSD${activeOsdScreen} layout (${OSD_ELEMENTS.length} elements). Switch screens and Paste to apply.`
    })
  }, [snapshot, activeOsdScreen, setParameterNotice])

  const handlePasteOsdLayout = useCallback(() => {
    if (!copiedOsdLayout) {
      return
    }
    for (const [id, vals] of Object.entries(copiedOsdLayout.cells)) {
      if (vals.en !== undefined) setDraft(`OSD${activeOsdScreen}_${id}_EN`, String(vals.en))
      if (vals.x !== undefined) setDraft(`OSD${activeOsdScreen}_${id}_X`, String(vals.x))
      if (vals.y !== undefined) setDraft(`OSD${activeOsdScreen}_${id}_Y`, String(vals.y))
    }
    setParameterNotice({
      tone: 'success',
      text: `Pasted OSD${copiedOsdLayout.sourceScreen} layout onto OSD${activeOsdScreen}. Review the staged changes, then Save OSD.`
    })
  }, [copiedOsdLayout, activeOsdScreen, setDraft, setParameterNotice])

  return {
    activeOsdScreen,
    setActiveOsdScreen,
    copiedOsdLayout,
    osdScreenOptionFields,
    osdScreenEnableEntries,
    osdElementMatrix,
    osdPreviewElements,
    handleOsdElementMove,
    handleCopyOsdLayout,
    handlePasteOsdLayout
  }
}
