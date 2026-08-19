// The FILTn filter bank, and the axis filters that point into it.
//
// ArduPilot's AP_Filter library gives the vehicle up to eight standalone
// filters (Filter/AP_Filter.cpp). Each slot has a FILTn_TYPE -- 0 Disable,
// 1 Notch Filter (AP_Filter_params.cpp) -- and a notch slot adds FILTn_NOTCH_FREQ,
// FILTn_NOTCH_Q and FILTn_NOTCH_ATT (AP_NotchFilter_params.cpp).
//
// The rate loops then REFERENCE a slot by index: ATC_RAT_<axis>_NTF picks the
// filter on that axis' target, ATC_RAT_<axis>_NEF the one on its error, with 0
// meaning none (AC_PID.cpp, @Range 0 8). Those two were bare number boxes, so
// choosing one meant remembering which slot held what -- and a slot configured
// on the vehicle showed up nowhere on the Filters page at all.
//
// Pure: live values in, a description of the bank out.

/** AP_FILTER_NUM_FILTERS: eight slots, ArduPilot's own ceiling. */
export const FILTER_BANK_SIZE = 8

/** AP_Filter_params.cpp @Values for FILTn_TYPE. */
export const FILTER_TYPE_NONE = 0
export const FILTER_TYPE_NOTCH = 1

export interface FilterBankSlot {
  /** 1-based, matching the parameter names and the NTF/NEF index. */
  index: number
  /** FILTn_TYPE, or undefined when the vehicle does not report the slot. */
  type?: number
  configured: boolean
  centreFreqHz?: number
  quality?: number
  attenuationDb?: number
  /** "Notch 80 Hz", or "not configured". Used for the index dropdowns. */
  summary: string
}

export interface FilterBank {
  /** Every slot the vehicle reports, configured or not. */
  slots: FilterBankSlot[]
  /** Only the ones actually doing something. */
  configured: FilterBankSlot[]
  /** The first free slot, for "add another filter"; undefined when full. */
  nextFreeIndex?: number
  /** False when the firmware has no filter bank at all. */
  supported: boolean
}

function round(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 10) / 10
}

function describe(type: number | undefined, freqHz: number | undefined, attDb: number | undefined): string {
  if (type === undefined) return 'not available'
  if (type === FILTER_TYPE_NONE) return 'not configured'
  if (type !== FILTER_TYPE_NOTCH) return `type ${type}`
  const freq = freqHz !== undefined && freqHz > 0 ? `${round(freqHz)} Hz` : 'no frequency set'
  return attDb !== undefined && attDb > 0 ? `Notch ${freq}, ${round(attDb)} dB` : `Notch ${freq}`
}

export function buildFilterBank(values: ReadonlyMap<string, number>): FilterBank {
  const slots: FilterBankSlot[] = []
  for (let index = 1; index <= FILTER_BANK_SIZE; index += 1) {
    const type = values.get(`FILT${index}_TYPE`)
    if (type === undefined) {
      continue
    }
    const centreFreqHz = values.get(`FILT${index}_NOTCH_FREQ`)
    const quality = values.get(`FILT${index}_NOTCH_Q`)
    const attenuationDb = values.get(`FILT${index}_NOTCH_ATT`)
    slots.push({
      index,
      type,
      configured: Math.round(type) !== FILTER_TYPE_NONE,
      centreFreqHz,
      quality,
      attenuationDb,
      summary: describe(Math.round(type), centreFreqHz, attenuationDb)
    })
  }

  const configured = slots.filter((slot) => slot.configured)
  return {
    slots,
    configured,
    nextFreeIndex: slots.find((slot) => !slot.configured)?.index,
    supported: slots.length > 0
  }
}

/**
 * Options for ATC_RAT_<axis>_NTF / _NEF: which slot this axis filters through.
 *
 * Every slot the vehicle has is offered, configured or not -- picking an empty
 * slot and then filling it in is a legitimate order to work in, and hiding the
 * empty ones would make the list change shape as the bank is built up. What
 * each one currently IS goes in the label, which is the part that was missing.
 */
export function buildFilterIndexOptions(bank: FilterBank): { value: number; label: string }[] {
  return [
    { value: 0, label: 'None' },
    ...bank.slots.map((slot) => ({ value: slot.index, label: `FILT${slot.index} — ${slot.summary}` }))
  ]
}

/** The parameters one slot owns, for rendering it as a group. */
export function filterSlotParamIds(index: number): string[] {
  return [`FILT${index}_TYPE`, `FILT${index}_NOTCH_FREQ`, `FILT${index}_NOTCH_Q`, `FILT${index}_NOTCH_ATT`]
}
