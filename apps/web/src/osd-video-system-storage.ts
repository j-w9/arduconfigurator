// Which video system the OSD preview draws for a given aircraft.
//
// The preview grid is display-only — ArduPilot stores element positions as raw
// character cells regardless — but the grid SIZE decides where those cells land
// on screen, so previewing a 50-column Walksnail layout on a 60-column grid
// draws every element bunched into the left 83% of the frame. Picking the right
// system therefore matters, and having it reset to Analog on every tab switch
// meant re-picking it constantly.
//
// Two sources, in order:
//
//  1. The aircraft's own OSDn_TXT_RES, which is what the FC actually drives the
//     link at. Authoritative, per-drone, and needs no configuration from the
//     operator at all.
//  2. The operator's own last choice for this board, which wins over (1)
//     because TXT_RES cannot distinguish the two 50-column systems: ArduPilot
//     only encodes 30x16 / 50x18 / 60x22, so HDZero and Walksnail Avatar are
//     the same value to it.
//
// Keyed by board uid the same way guided-setup progress is, so one operator's
// two aircraft do not share a setting.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

const STORAGE_KEY_PREFIX = 'arduconfigurator.osd-video-system.'

/** Grid presets the preview can draw, keyed as the Osd view names them. */
export type StoredOsdVideoSystem = string

export interface StoredOsdPreviewChoice {
  version: 1
  videoSystem: StoredOsdVideoSystem
  analogSubMode: 'pal' | 'ntsc'
}

/**
 * Storage key for the connected aircraft, or undefined while its identity is
 * not known. Same derivation as guided-setup progress: the AUTOPILOT_VERSION
 * uid is per-unit unique, so two identical board models stay distinct.
 */
export function deriveOsdPreviewKey(snapshot: ConfiguratorSnapshot): string | undefined {
  if (snapshot.connection.kind !== 'connected') {
    return undefined
  }

  const board = snapshot.hardware.board
  if (!board) {
    return undefined
  }

  if (board.uid) {
    return `${STORAGE_KEY_PREFIX}uid:${board.uid}`
  }

  return `${STORAGE_KEY_PREFIX}board:${board.boardType}:${board.vendorId}:${board.productId}`
}

/**
 * The operator's stored choice for this aircraft, if any. Never throws: a
 * corrupt or unreadable entry is treated as "no preference" rather than
 * breaking the OSD tab.
 */
export function readStoredOsdPreview(key: string | undefined): StoredOsdPreviewChoice | undefined {
  if (!key || typeof localStorage === 'undefined') {
    return undefined
  }

  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw) as StoredOsdPreviewChoice
    if (parsed?.version !== 1 || typeof parsed.videoSystem !== 'string') {
      return undefined
    }
    return {
      version: 1,
      videoSystem: parsed.videoSystem,
      analogSubMode: parsed.analogSubMode === 'pal' ? 'pal' : 'ntsc'
    }
  } catch {
    return undefined
  }
}

/** Remember this aircraft's preview choice. Silently a no-op without storage. */
export function writeStoredOsdPreview(key: string | undefined, choice: StoredOsdPreviewChoice): void {
  if (!key || typeof localStorage === 'undefined') {
    return
  }

  try {
    localStorage.setItem(key, JSON.stringify(choice))
  } catch {
    // Private browsing / quota. A forgotten preference is not worth an error.
  }
}

/**
 * The video system implied by the aircraft's own OSDn_TXT_RES.
 *
 * AP_OSD_Screen.cpp declares `@Values: 0:30x16,1:50x18,2:60x22`, so the
 * parameter pins the grid WIDTH exactly. Width is what actually misplaces
 * elements, which makes this a good default even where it cannot name the
 * exact goggles.
 *
 * 50-wide is genuinely ambiguous — HDZero and Walksnail Avatar both live
 * there — so this returns the ArduPilot-labelled 50x18 system and the
 * operator's stored choice overrides it.
 */
export function osdVideoSystemFromTxtRes(txtRes: number | undefined): string | undefined {
  switch (txtRes) {
    case 0:
      return 'analog'
    case 1:
      return 'hdzero'
    case 2:
      return 'dji_o3'
    default:
      return undefined
  }
}
