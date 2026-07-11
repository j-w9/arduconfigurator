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
  RC_LOGIC_OPT_LEVEL_INDEX_MASK,
  RC_LOGIC_OPT_LEVEL_INDEX_SHIFT,
  RC_LOGIC_OPT_LEVEL_MODE_MASK,
  RC_LOGIC_OPT_NEGATE_BIT,
  RC_LOGIC_OPT_SOURCE_TYPE_MASK,
  RcLogicSourceType,
  isRcLogicLevelSelectFunction
} from '@arduconfig/param-metadata'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import type { ParameterDraftValues } from '../hooks/use-parameter-drafts'
import { type RcMixerAssignment, type RcMixerFunctionDefinition } from './rc-mixer'

const NEGATE_MASK = 1 << RC_LOGIC_OPT_NEGATE_BIT
const LEVEL_INDEX_MASK_SHIFTED = RC_LOGIC_OPT_LEVEL_INDEX_MASK << RC_LOGIC_OPT_LEVEL_INDEX_SHIFT
const LEVEL_FIELD_MASK = RC_LOGIC_OPT_LEVEL_MODE_MASK | LEVEL_INDEX_MASK_SHIFTED

export interface RcLogicLevelSelection {
  levelMode: boolean
  /** Zero-based level index (0-7) from OPT bits 5-7. */
  outputLevel: number
}

/** Decode OPT bit 4 (level mode) + bits 5-7 (zero-based level index). */
export function decodeLevel(opt: number): RcLogicLevelSelection {
  return {
    levelMode: (opt & RC_LOGIC_OPT_LEVEL_MODE_MASK) !== 0,
    outputLevel: (opt >> RC_LOGIC_OPT_LEVEL_INDEX_SHIFT) & RC_LOGIC_OPT_LEVEL_INDEX_MASK
  }
}

/** Fold level mode + a zero-based level index into OPT, preserving the other
 *  bits. Clearing level mode wipes both the mode bit and the index. */
export function encodeLevel(opt: number, levelMode: boolean, outputLevel: number): number {
  const cleared = opt & ~LEVEL_FIELD_MASK
  if (!levelMode) {
    return cleared
  }
  const index = Math.max(0, Math.min(RC_LOGIC_OPT_LEVEL_INDEX_MASK, Math.round(outputLevel)))
  return cleared | RC_LOGIC_OPT_LEVEL_MODE_MASK | (index << RC_LOGIC_OPT_LEVEL_INDEX_SHIFT)
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

/** A non-range RCL term (condition or link) shown in the Logic section rather
 *  than the channel grid — it has no channel/PWM window, just a source value. */
export interface RcLogicLogicTerm {
  /** rcl-<term> — same id scheme as range assignments. */
  id: string
  /** 'condition' → SRC is a condition id (0-4); 'link' → SRC is the watched AUX_FUNC. */
  sourceType: 'condition' | 'link'
  /** Target AUX_FUNC this term drives. */
  functionId: number
  /** Condition id (condition) or watched AUX_FUNC (link) — the RCL SRC value. */
  sourceValue: number
  /** Negate (OPT bit 3). */
  inverted: boolean
  /** VTX level selection (OPT bit 4 + bits 5-7), same encoding as range terms. */
  levelMode?: boolean
  outputLevel?: number
}

export interface RcLogicModel {
  enabled: boolean
  /** Range-term assignments (the channel grid). */
  assignments: RcMixerAssignment[]
  /** Condition/link terms (the Logic conditions & links section). */
  logicTerms: RcLogicLogicTerm[]
  /** First unused term slot (1-based), or null when the table is full. */
  freeTermIndex: number | null
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
  const logicTerms: RcLogicLogicTerm[] = []
  let freeTermIndex: number | null = null

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
    const level = decodeLevel(opt)
    if (sourceType === RcLogicSourceType.Range) {
      assignments.push({
        id: rcLogicAssignmentId(term),
        channel: effective(ids.src, 0),
        functionId: func,
        lowPwm: effective(ids.min, ADD_DEFAULT_LOW),
        highPwm: effective(ids.max, ADD_DEFAULT_HIGH),
        inverted: (opt & NEGATE_MASK) !== 0,
        levelMode: level.levelMode,
        outputLevel: level.outputLevel
      })
    } else {
      logicTerms.push({
        id: rcLogicAssignmentId(term),
        sourceType: sourceType === RcLogicSourceType.Link ? 'link' : 'condition',
        functionId: func,
        sourceValue: effective(ids.src, 0),
        inverted: (opt & NEGATE_MASK) !== 0,
        levelMode: level.levelMode,
        outputLevel: level.outputLevel
      })
    }
  }

  return {
    enabled: effective('RCL_ENABLE', 0) === 1,
    assignments,
    logicTerms,
    freeTermIndex
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
  // Negate (bit 3) and the level field (bit 4 mode + bits 5-7 index) all live in
  // OPT — fold every OPT-affecting change into one value read from the existing
  // OPT so they don't clobber each other. Switching to a function that has no
  // multi-level output also clears the level field, so a leftover level doesn't
  // strand the new function in selector mode.
  const clearsLevel = patch.functionId !== undefined && !isRcLogicLevelSelectFunction(patch.functionId)
  const levelTouched = patch.levelMode !== undefined || patch.outputLevel !== undefined
  if (patch.inverted !== undefined || levelTouched || clearsLevel) {
    const current = effective(ids.opt, 0)
    let opt = current
    if (patch.inverted !== undefined) {
      opt = patch.inverted ? opt | NEGATE_MASK : opt & ~NEGATE_MASK
    }
    if (levelTouched) {
      const existing = decodeLevel(current)
      const levelMode = patch.levelMode ?? existing.levelMode
      const outputLevel = patch.outputLevel ?? existing.outputLevel
      opt = encodeLevel(opt, levelMode, outputLevel)
    } else if (clearsLevel) {
      opt = encodeLevel(opt, false, 0)
    }
    if (opt !== current) {
      next[ids.opt] = String(opt)
    }
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

/** Drafts that allocate a new CONDITION logic term on the first free slot. It
 *  starts on condition 0 (RC failsafe) with no function; the operator picks the
 *  target function and can flip it to a link term. Null when the table is full. */
export function rcLogicAddLogicTermDrafts(model: RcLogicModel): ParameterDraftValues | null {
  if (model.freeTermIndex === null) {
    return null
  }
  const ids = rcLogicTermParamIds(model.freeTermIndex)
  return {
    [ids.func]: '0', // operator picks the target function
    [ids.opt]: String(RcLogicSourceType.Condition), // condition source, OR, not negated, no level
    [ids.src]: '0' // condition 0 = RC failsafe
  }
}

/** Drafts for editing one field of a logic (condition/link) term. Source type
 *  (OPT bits 0-1), negate (bit 3), and level (bit 4 + 5-7) all fold into OPT;
 *  the source value (condition id or watched AUX_FUNC) is SRC. Switching the
 *  source type resets SRC, since a condition id and a watched function are
 *  different value spaces. */
export function rcLogicUpdateLogicTermDrafts(
  parameters: readonly ParameterState[],
  drafts: ParameterDraftValues,
  term: number,
  patch: Partial<RcLogicLogicTerm>
): ParameterDraftValues {
  const ids = rcLogicTermParamIds(term)
  const { effective } = makeReaders(parameters, drafts)
  const next: ParameterDraftValues = {}
  if (patch.functionId !== undefined) next[ids.func] = String(patch.functionId)
  if (patch.sourceValue !== undefined) {
    next[ids.src] = String(patch.sourceValue)
  } else if (patch.sourceType !== undefined) {
    next[ids.src] = '0' // type changed without a new value → reset the source
  }
  const clearsLevel = patch.functionId !== undefined && !isRcLogicLevelSelectFunction(patch.functionId)
  const optTouched =
    patch.sourceType !== undefined ||
    patch.inverted !== undefined ||
    patch.levelMode !== undefined ||
    patch.outputLevel !== undefined ||
    clearsLevel
  if (optTouched) {
    const current = effective(ids.opt, RcLogicSourceType.Condition)
    let opt = current
    if (patch.sourceType !== undefined) {
      const sourceType = patch.sourceType === 'link' ? RcLogicSourceType.Link : RcLogicSourceType.Condition
      opt = (opt & ~RC_LOGIC_OPT_SOURCE_TYPE_MASK) | sourceType
    }
    if (patch.inverted !== undefined) {
      opt = patch.inverted ? opt | NEGATE_MASK : opt & ~NEGATE_MASK
    }
    if (patch.levelMode !== undefined || patch.outputLevel !== undefined) {
      const existing = decodeLevel(current)
      opt = encodeLevel(opt, patch.levelMode ?? existing.levelMode, patch.outputLevel ?? existing.outputLevel)
    } else if (clearsLevel) {
      opt = encodeLevel(opt, false, 0)
    }
    if (opt !== current) {
      next[ids.opt] = String(opt)
    }
  }
  return next
}
