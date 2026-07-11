// Read/write bridge between the RC Mixer view and the AP_RC_Logic parameter
// family (RCL_*). The firmware is at Phase 1 — range terms driving discrete AUX
// functions — which maps 1:1 onto the mixer's channel / function / low-high /
// inverted model. Each visible assignment is one RANGE term:
//   channel -> RCL<n>_SRC,  low/high -> RCL<n>_MIN/_MAX,
//   inverted -> RCL<n>_OPT bit 3 (negate),  function -> RCL<n>_FUNC.
// Edits are returned as parameter DRAFTS; the existing verified write path (and
// the global "staged changes" bar) applies them — nothing here writes directly.

import {
  RC_LOGIC_AUX_FUNCTION_OPTIONS,
  RC_LOGIC_NUM_TERMS,
  RC_LOGIC_OPT_NEGATE_BIT,
  RC_LOGIC_OPT_OUTPOS_MASK,
  RC_LOGIC_OPT_OUTPOS_SHIFT,
  RC_LOGIC_OPT_SOURCE_TYPE_MASK,
  RcLogicOutputPosition,
  RcLogicSourceType
} from '@arduconfig/param-metadata'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import type { ParameterDraftValues } from '../hooks/use-parameter-drafts'
import { type RcMixerAssignment, type RcMixerFunctionDefinition, type RcMixerOutputPosition } from './rc-mixer'

const NEGATE_MASK = 1 << RC_LOGIC_OPT_NEGATE_BIT
const OUTPOS_MASK_SHIFTED = RC_LOGIC_OPT_OUTPOS_MASK << RC_LOGIC_OPT_OUTPOS_SHIFT

/** Decode OPT bits 4-5 into the view model's output position. */
export function decodeOutputPosition(opt: number): RcMixerOutputPosition {
  const value = (opt >> RC_LOGIC_OPT_OUTPOS_SHIFT) & RC_LOGIC_OPT_OUTPOS_MASK
  if (value === RcLogicOutputPosition.Low) return 'low'
  if (value === RcLogicOutputPosition.Middle) return 'middle'
  return 'high'
}

/** Fold an output position into OPT bits 4-5, preserving the other bits. */
export function encodeOutputPosition(opt: number, position: RcMixerOutputPosition): number {
  const value =
    position === 'low'
      ? RcLogicOutputPosition.Low
      : position === 'middle'
        ? RcLogicOutputPosition.Middle
        : RcLogicOutputPosition.High
  return (opt & ~OUTPOS_MASK_SHIFTED) | (value << RC_LOGIC_OPT_OUTPOS_SHIFT)
}
const ADD_DEFAULT_LOW = 1700
const ADD_DEFAULT_HIGH = 2100

export interface RcLogicTermParamIds {
  func: string
  opt: string
  src: string
  min: string
  max: string
}

export function rcLogicTermParamIds(term: number): RcLogicTermParamIds {
  const prefix = `RCL${term}_`
  return {
    func: `${prefix}FUNC`,
    opt: `${prefix}OPT`,
    src: `${prefix}SRC`,
    min: `${prefix}MIN`,
    max: `${prefix}MAX`
  }
}

/** `rcl-<term>` <-> term index used as the assignment id in the shared view. */
export function rcLogicAssignmentId(term: number): string {
  return `rcl-${term}`
}
export function rcLogicTermFromAssignmentId(id: string): number | null {
  const match = /^rcl-(\d+)$/.exec(id)
  return match ? Number(match[1]) : null
}

export interface RcLogicModel {
  enabled: boolean
  /** Range-term assignments, one per visible term (Phase 1). */
  assignments: RcMixerAssignment[]
  /** First unused term slot (1-based), or null when the table is full. */
  freeTermIndex: number | null
  /** Configured terms that aren't editable range terms (link/condition) — kept
   *  intact but not shown in the channel editor. */
  hiddenTermCount: number
}

function makeReaders(parameters: readonly ParameterState[], drafts: ParameterDraftValues) {
  const liveById = new Map(parameters.map((parameter) => [parameter.id, parameter.value]))
  const hasDraft = (id: string): boolean => drafts[id] !== undefined
  const effective = (id: string, fallback: number): number => {
    const draft = drafts[id]
    if (draft !== undefined && draft !== '') {
      const value = Number(draft)
      return Number.isFinite(value) ? value : fallback
    }
    return liveById.get(id) ?? fallback
  }
  return { hasDraft, effective }
}

export function readRcLogicModel(
  parameters: readonly ParameterState[],
  drafts: ParameterDraftValues
): RcLogicModel {
  const { hasDraft, effective } = makeReaders(parameters, drafts)

  const assignments: RcMixerAssignment[] = []
  let freeTermIndex: number | null = null
  let hiddenTermCount = 0

  for (let term = 1; term <= RC_LOGIC_NUM_TERMS; term += 1) {
    const ids = rcLogicTermParamIds(term)
    const func = effective(ids.func, 0)
    const opt = effective(ids.opt, 0)
    // A slot is "used" when it has a configured function OR any pending draft
    // (a row the operator is mid-adding). Everything else is free for a new row.
    const touched = func !== 0 || hasDraft(ids.func) || hasDraft(ids.opt) || hasDraft(ids.src) || hasDraft(ids.min) || hasDraft(ids.max)
    if (!touched) {
      if (freeTermIndex === null) {
        freeTermIndex = term
      }
      continue
    }
    const sourceType = opt & RC_LOGIC_OPT_SOURCE_TYPE_MASK
    if (sourceType !== RcLogicSourceType.Range) {
      hiddenTermCount += 1
      continue
    }
    assignments.push({
      id: rcLogicAssignmentId(term),
      channel: effective(ids.src, 0),
      functionId: func,
      lowPwm: effective(ids.min, ADD_DEFAULT_LOW),
      highPwm: effective(ids.max, ADD_DEFAULT_HIGH),
      inverted: (opt & NEGATE_MASK) !== 0,
      outputPosition: decodeOutputPosition(opt)
    })
  }

  return {
    enabled: effective('RCL_ENABLE', 0) === 1,
    assignments,
    freeTermIndex,
    hiddenTermCount
  }
}

/** Function picker catalog for the FUNC dropdown — the full AUX_FUNC list. */
export function rcLogicFunctionCatalog(): RcMixerFunctionDefinition[] {
  return RC_LOGIC_AUX_FUNCTION_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    description: option.description ?? `AUX function ${option.value}.`
  }))
}

/** Drafts that allocate a new range term on `channel`. Null when full. */
export function rcLogicAddDrafts(model: RcLogicModel, channel: number): ParameterDraftValues | null {
  if (model.freeTermIndex === null) {
    return null
  }
  const ids = rcLogicTermParamIds(model.freeTermIndex)
  return {
    [ids.func]: '0', // operator picks; 0 keeps the row disabled until then
    [ids.opt]: '0', // range source, OR, not negated
    [ids.src]: String(channel),
    [ids.min]: String(ADD_DEFAULT_LOW),
    [ids.max]: String(ADD_DEFAULT_HIGH)
  }
}

/** Drafts for editing one field of an existing/pending term. `inverted` is
 *  folded into OPT bit 3 while preserving the other option bits. */
export function rcLogicUpdateDrafts(
  parameters: readonly ParameterState[],
  drafts: ParameterDraftValues,
  term: number,
  patch: Partial<RcMixerAssignment>
): ParameterDraftValues {
  const ids = rcLogicTermParamIds(term)
  const { effective } = makeReaders(parameters, drafts)
  const next: ParameterDraftValues = {}
  if (patch.functionId !== undefined) next[ids.func] = String(patch.functionId)
  if (patch.channel !== undefined) next[ids.src] = String(patch.channel)
  if (patch.lowPwm !== undefined) next[ids.min] = String(patch.lowPwm)
  if (patch.highPwm !== undefined) next[ids.max] = String(patch.highPwm)
  // Negate (bit 3) and output position (bits 4-5) both live in OPT — fold both
  // into a single value read from the existing OPT so one doesn't clobber the
  // other when they're patched together.
  if (patch.inverted !== undefined || patch.outputPosition !== undefined) {
    let opt = effective(ids.opt, 0)
    if (patch.inverted !== undefined) {
      opt = patch.inverted ? opt | NEGATE_MASK : opt & ~NEGATE_MASK
    }
    if (patch.outputPosition !== undefined) {
      opt = encodeOutputPosition(opt, patch.outputPosition)
    }
    next[ids.opt] = String(opt)
  }
  return next
}

export interface RcLogicRemovePlan {
  /** Pending drafts on this term to clear. */
  clear: string[]
  /** When the term is live (FUNC != 0 in params), the draft that disables it. */
  disable: ParameterDraftValues
}

/** Removing an assignment clears any pending drafts on the term and, if it is a
 *  live term, stages FUNC = 0 to disable the row on the next write. */
export function rcLogicRemovePlan(parameters: readonly ParameterState[], term: number): RcLogicRemovePlan {
  const ids = rcLogicTermParamIds(term)
  const liveFunc = parameters.find((parameter) => parameter.id === ids.func)?.value ?? 0
  return {
    clear: [ids.func, ids.opt, ids.src, ids.min, ids.max],
    disable: liveFunc !== 0 ? { [ids.func]: '0' } : {}
  }
}
