// The firmware's standard 11-band table.
//
// There is no "reset to defaults" command in the protocol: restoring them means
// UPLOADING this table, so the ground station has to carry a copy. Nothing is
// stored until the first upload either, so a fresh board already reports these
// — which makes this also the reference for "has anything actually changed?".
//
// Values are transcribed from the firmware, not from memory:
//   names        AP_VideoTX::band_names       (AP_VideoTX.cpp)
//   frequencies  AP_VideoTX::VIDEO_CHANNELS   (AP_VideoTX.cpp)
//   order        VTX_BAND's own @Values list  (A, B, E, F, R, L, 1G3_A,
//                1G3_B, X, 3G3_A, 3G3_B)
//
// The letters are the single characters the OSD shows, which are the
// Betaflight-compatible ones rather than the band NAMES: 1G3_A/1G3_B are U/V
// and 3G3_A/3G3_B are C/D.

import type { VtxTable, VtxTableBand } from './vtx-table.js'
import { VTX_TABLE_VERSION } from './vtx-table.js'

interface DefaultBandSpec {
  name: string
  letter: string
  frequencies: readonly number[]
}

const DEFAULT_BANDS: readonly DefaultBandSpec[] = [
  { name: 'A', letter: 'A', frequencies: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725] },
  { name: 'B', letter: 'B', frequencies: [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866] },
  { name: 'E', letter: 'E', frequencies: [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945] },
  { name: 'F', letter: 'F', frequencies: [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880] },
  { name: 'R', letter: 'R', frequencies: [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917] },
  { name: 'L', letter: 'L', frequencies: [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621] },
  { name: '1G3_A', letter: 'U', frequencies: [1080, 1120, 1160, 1200, 1240, 1280, 1320, 1360] },
  { name: '1G3_B', letter: 'V', frequencies: [1080, 1120, 1160, 1200, 1258, 1280, 1320, 1360] },
  { name: 'X', letter: 'X', frequencies: [4990, 5020, 5050, 5080, 5110, 5140, 5170, 5200] },
  { name: '3G3_A', letter: 'C', frequencies: [3330, 3350, 3370, 3390, 3410, 3430, 3450, 3470] },
  { name: '3G3_B', letter: 'D', frequencies: [3170, 3190, 3210, 3230, 3250, 3270, 3290, 3310] }
] as const

export const VTX_TABLE_DEFAULT_BAND_COUNT = DEFAULT_BANDS.length
export const VTX_TABLE_DEFAULT_CHANNEL_COUNT = 8

/**
 * A fresh copy of the standard table.
 *
 * Returns a NEW object every call: the caller edits it, and a shared frozen
 * constant handed to an editor is how a "default" quietly acquires somebody
 * else's changes.
 */
export function defaultVtxTable(): VtxTable {
  return {
    version: VTX_TABLE_VERSION,
    numChannels: VTX_TABLE_DEFAULT_CHANNEL_COUNT,
    bands: DEFAULT_BANDS.map(
      (band): VtxTableBand => ({
        name: band.name,
        letter: band.letter,
        // The firmware's own bands: the VTX uses its factory frequency map.
        isFactory: true,
        frequencies: [...band.frequencies]
      })
    )
  }
}

/** Whether a table is byte-for-byte the standard one (ignoring band order). */
export function isDefaultVtxTable(table: VtxTable): boolean {
  if (
    table.numChannels !== VTX_TABLE_DEFAULT_CHANNEL_COUNT ||
    table.bands.length !== DEFAULT_BANDS.length
  ) {
    return false
  }
  return table.bands.every((band, index) => {
    const expected = DEFAULT_BANDS[index]
    return (
      expected !== undefined &&
      band.name === expected.name &&
      band.letter === expected.letter &&
      band.isFactory &&
      expected.frequencies.every((freq, channel) => band.frequencies[channel] === freq)
    )
  })
}
