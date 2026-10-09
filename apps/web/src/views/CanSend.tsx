// Send: put a DroneCAN message (or service request), or any raw frame, on the
// forwarded bus -- once, or on a repeat -- and see what came back.
//
// The DroneCAN form is built from the type's DSDL, so every type in the
// bundled set can be composed, with its constants offered as named values.
// What a send can do is said before it goes: anything that can move something
// (and every raw frame -- the app cannot know what an arbitrary id does) sits
// behind the same motor-safety box as the motor tests; anything that changes a
// node (restart, firmware, erase) asks once more. Presentational: the sender
// hook does the sending and keeps the history.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'
import type {
  DronecanCatalogue,
  DronecanSectionDesc,
  DronecanTypeDesc,
  DronecanValue
} from '@arduconfig/dronecan-dsdl'

import { InfoDot } from './InfoDot'
import { DronecanFieldTree } from './DronecanFieldTree'
import type { CanSendHistoryEntry, CanSendJob } from '../hooks/use-can-sender'
import {
  CAN_SEND_MIN_PERIOD_MS,
  buildDronecanSendFrames,
  canSendableTypes,
  defaultDronecanValue,
  dronecanFieldConstants,
  dronecanPrimitiveLimits,
  dronecanSendHazard,
  isDronecanByteArray,
  parseRawCanFrame,
  setDronecanValueAt,
  type CanSendFrame,
  type CanSendHazard
} from '../view-models/can-send'
import { dronecanDisplayName, transferFieldTree } from '../view-models/dronecan-field-tree'

export interface CanSendViewProps {
  catalogue: DronecanCatalogue
  /** This app's DroneCAN node id: the source of what it sends. */
  sourceNodeId: number
  /** The bus being forwarded ("CAN1"), when it is. */
  busLabel: string | undefined
  /** Why nothing can be sent right now (not forwarding, armed, ...). */
  blockedReason: string | undefined
  /** Nodes to address a request to. */
  nodes: readonly { nodeId: number; label: string }[]
  nodeLabel: (nodeId: number) => string | undefined
  history: readonly CanSendHistoryEntry[]
  repeatingId: number | undefined
  onSend: (job: CanSendJob) => void
  onStartRepeat: (job: CanSendJob, periodMs: number) => void
  onStopRepeat: () => void
  onClearHistory: () => void
  /** The shared motor-safety acknowledgement (one box everywhere motors spin). */
  motionAcknowledged: boolean
  onMotionAcknowledged: (value: boolean) => void
}

type Mode = 'dronecan' | 'raw'

interface Draft {
  mode: Mode
  typeName: string
  values: Record<string, { [field: string]: DronecanValue }>
  destination: string
  priority: string
  raw: { idText: string; dataText: string; extended: boolean; fd: boolean }
  periodMs: string
}

// What was being composed survives leaving the Send page (and coming back to
// read a response in Messages), for the session.
let lastDraft: Draft = {
  mode: 'dronecan',
  typeName: '',
  values: {},
  destination: '',
  priority: '16',
  raw: { idText: '', dataText: '', extended: false, fd: false },
  periodMs: '100'
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

function frameId(frame: CanSendFrame): string {
  return frame.id.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, '0')
}

// ---------------------------------------------------------------------------
// The DSDL-driven form

/** A number field that lets "-", "1." and the like through while typing. */
function NumberInput(props: {
  value: DronecanValue
  desc: Extract<DronecanTypeDesc, { p: string }>
  onChange: (value: DronecanValue) => void
  label: string
  testId?: string
}): ReactNode {
  const limits = dronecanPrimitiveLimits(props.desc)
  const shown = String(props.value)
  const [text, setText] = useState(shown)
  // What the field last showed: a change from outside (a constant picked, a
  // type switched) resets the text; the field's own edits do not.
  const [synced, setSynced] = useState(shown)
  if (synced !== shown) {
    setSynced(shown)
    setText(shown)
  }
  const parsed = (() => {
    const clean = text.trim()
    if (clean === '' || clean === '-') return undefined
    if (limits.wide) return /^-?\d+$/.test(clean) ? BigInt(clean) : undefined
    const number = Number(clean)
    if (!Number.isFinite(number) || (limits.integer && !Number.isInteger(number))) return undefined
    return number
  })()
  const outOfRange =
    typeof parsed === 'number' &&
    ((limits.min !== undefined && parsed < limits.min) || (limits.max !== undefined && parsed > limits.max))
  return (
    <span className="can-send__number">
      <input
        type="text"
        inputMode={limits.integer ? 'numeric' : 'decimal'}
        value={text}
        aria-label={props.label}
        aria-invalid={parsed === undefined || outOfRange}
        title={limits.min !== undefined ? `${limits.min} … ${limits.max}` : undefined}
        onChange={(event) => {
          setText(event.target.value)
          const clean = event.target.value.trim()
          if (limits.wide) {
            if (/^-?\d+$/.test(clean)) {
              setSynced(String(BigInt(clean)))
              props.onChange(BigInt(clean))
            }
            return
          }
          const number = Number(clean)
          if (clean !== '' && Number.isFinite(number) && (!limits.integer || Number.isInteger(number))) {
            setSynced(String(number))
            props.onChange(number)
          }
        }}
        data-testid={props.testId}
      />
      {outOfRange ? (
        <small className="can-send__range">
          {limits.min} … {limits.max}
        </small>
      ) : null}
    </span>
  )
}

/** A uint8 array as text (names, strings) or as hex bytes. */
function ByteArrayInput(props: {
  value: DronecanValue
  max: number
  onChange: (value: DronecanValue) => void
  label: string
  testId?: string
}): ReactNode {
  const bytes = Array.isArray(props.value) ? (props.value as number[]) : []
  const printable = bytes.every((byte) => byte >= 0x20 && byte < 0x7f)
  const [asHex, setAsHex] = useState(!printable)
  const [hexText, setHexText] = useState(() => hex(Uint8Array.from(bytes)))
  const [hexError, setHexError] = useState(false)
  return (
    <span className="can-send__bytes">
      {asHex ? (
        <input
          type="text"
          value={hexText}
          spellCheck={false}
          aria-label={`${props.label} (hex)`}
          aria-invalid={hexError}
          onChange={(event) => {
            setHexText(event.target.value)
            const clean = event.target.value.replace(/0x/gi, '').replace(/[\s,]+/g, '')
            const valid = clean.length % 2 === 0 && /^[0-9a-f]*$/i.test(clean)
            setHexError(!valid)
            if (valid) {
              props.onChange(Array.from({ length: Math.min(props.max, clean.length / 2) }, (_, index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)))
            }
          }}
          data-testid={props.testId}
        />
      ) : (
        <input
          type="text"
          value={String.fromCharCode(...bytes)}
          spellCheck={false}
          maxLength={props.max}
          aria-label={props.label}
          onChange={(event) => props.onChange(Array.from(new TextEncoder().encode(event.target.value)).slice(0, props.max))}
          data-testid={props.testId}
        />
      )}
      <button
        type="button"
        className="can-send__toggle"
        onClick={() => {
          if (!asHex) setHexText(hex(Uint8Array.from(bytes)))
          setAsHex(!asHex)
        }}
        aria-pressed={asHex}
        title="Edit as hex bytes"
      >
        hex
      </button>
      <small className="can-monitor__dim">
        {bytes.length}/{props.max}
      </small>
    </span>
  )
}

/** A primitive array as a comma-separated list. */
function NumberListInput(props: {
  value: DronecanValue
  desc: Extract<DronecanTypeDesc, { a: DronecanTypeDesc }>
  onChange: (value: DronecanValue) => void
  label: string
  testId?: string
}): ReactNode {
  const items = Array.isArray(props.value) ? props.value : []
  const shown = items.map(String).join(', ')
  const [text, setText] = useState(shown)
  const [synced, setSynced] = useState(shown)
  if (synced !== shown) {
    setSynced(shown)
    setText(shown)
  }
  const element = props.desc.a as Extract<DronecanTypeDesc, { p: string }>
  const isBool = element.p === 'b'
  return (
    <span className="can-send__list">
      <input
        type="text"
        value={text}
        spellCheck={false}
        aria-label={props.label}
        placeholder={props.desc.m === 's' ? `${props.desc.max} values` : `up to ${props.desc.max} values`}
        onChange={(event) => {
          setText(event.target.value)
          const parts = event.target.value.split(/[\s,]+/).filter((part) => part !== '')
          const numbers = parts.map((part) => (isBool ? part === '1' || /^true$/i.test(part) : Number(part)))
          if (numbers.some((number) => typeof number === 'number' && !Number.isFinite(number))) return
          const next = numbers.slice(0, props.desc.max) as DronecanValue[]
          if (props.desc.m === 's') while (next.length < props.desc.max) next.push(isBool ? false : 0)
          setSynced(next.map(String).join(', '))
          props.onChange(next)
        }}
        data-testid={props.testId}
      />
      <small className="can-monitor__dim">
        {items.length}/{props.desc.max}
      </small>
    </span>
  )
}

interface EditorContext {
  catalogue: DronecanCatalogue
  testIdBase: string
}

function FieldEditor(props: {
  ctx: EditorContext
  name: string
  desc: DronecanTypeDesc
  value: DronecanValue
  section: DronecanSectionDesc
  path: readonly (string | number)[]
  onChange: (path: readonly (string | number)[], value: DronecanValue) => void
}): ReactNode {
  const { ctx, name, desc, value, section, path, onChange } = props
  const testId = `${ctx.testIdBase}-${path.join('.')}`
  if ('v' in desc) return null
  if ('p' in desc) {
    const constants = dronecanFieldConstants(section, name)
    return (
      <div className="can-send__field">
        <label className="can-send__field-name" title={`${desc.p === 'b' ? 'bool' : `${desc.p === 'f' ? 'float' : desc.p === 'u' ? 'uint' : 'int'}${desc.bits}`}`}>
          {name}
          <small>{desc.p === 'b' ? 'bool' : `${desc.p === 'f' ? 'float' : desc.p === 'u' ? 'uint' : 'int'}${desc.bits}`}</small>
        </label>
        {desc.p === 'b' ? (
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(path, event.target.checked)} aria-label={name} data-testid={testId} />
        ) : (
          <NumberInput value={value} desc={desc} onChange={(next) => onChange(path, next)} label={name} testId={testId} />
        )}
        {constants.length > 0 ? (
          <select
            className="can-send__consts"
            value={constants.find((entry) => String(entry.v) === String(value))?.n ?? ''}
            onChange={(event) => {
              const picked = constants.find((entry) => entry.n === event.target.value)
              if (picked) onChange(path, picked.v)
            }}
            aria-label={`${name}: named values`}
          >
            <option value="">—</option>
            {constants.map((entry) => (
              <option key={entry.n} value={entry.n}>
                {entry.n} = {String(entry.v)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    )
  }
  if ('r' in desc) {
    const nested = ctx.catalogue.section(desc.r, 'msg')
    return (
      <fieldset className="can-send__group">
        <legend>
          {name} <small>{dronecanDisplayName(desc.r)}</small>
        </legend>
        <SectionEditor ctx={ctx} section={nested} value={value} path={path} onChange={onChange} />
      </fieldset>
    )
  }
  // Arrays.
  if (isDronecanByteArray(desc)) {
    return (
      <div className="can-send__field">
        <label className="can-send__field-name">
          {name}
          <small>
            uint8[{desc.m === 'd' ? '<=' : ''}
            {desc.max}]
          </small>
        </label>
        <ByteArrayInput value={value} max={desc.max} onChange={(next) => onChange(path, next)} label={name} testId={testId} />
      </div>
    )
  }
  if ('p' in desc.a) {
    return (
      <div className="can-send__field">
        <label className="can-send__field-name">
          {name}
          <small>
            {desc.a.p === 'b' ? 'bool' : `${desc.a.p === 'f' ? 'float' : desc.a.p === 'u' ? 'uint' : 'int'}${desc.a.bits}`}[
            {desc.m === 'd' ? '<=' : ''}
            {desc.max}]
          </small>
        </label>
        <NumberListInput value={value} desc={desc} onChange={(next) => onChange(path, next)} label={name} testId={testId} />
      </div>
    )
  }
  const items = Array.isArray(value) ? value : []
  const element = desc.a
  const elementName = 'r' in element ? dronecanDisplayName(element.r) : 'item'
  return (
    <fieldset className="can-send__group">
      <legend>
        {name}{' '}
        <small>
          {elementName}[{desc.m === 'd' ? '<=' : ''}
          {desc.max}]
        </small>
      </legend>
      {items.map((item, index) => (
        <div key={index} className="can-send__array-item">
          <FieldEditor ctx={ctx} name={`${name}[${index}]`} desc={element} value={item} section={section} path={[...path, index]} onChange={onChange} />
          {desc.m === 'd' ? (
            <button
              type="button"
              className="can-monitor__icon-button"
              aria-label={`Remove ${name}[${index}]`}
              onClick={() => onChange(path, items.filter((_, other) => other !== index))}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      {desc.m === 'd' && items.length < desc.max ? (
        <button
          type="button"
          className="can-monitor__tool"
          onClick={() =>
            onChange(path, [...items, 'r' in element ? defaultDronecanValue(ctx.catalogue, ctx.catalogue.section(element.r, 'msg')) : 0])
          }
          data-testid={`${testId}-add`}
        >
          Add {elementName}
        </button>
      ) : null}
    </fieldset>
  )
}

function SectionEditor(props: {
  ctx: EditorContext
  section: DronecanSectionDesc
  value: DronecanValue
  path: readonly (string | number)[]
  onChange: (path: readonly (string | number)[], value: DronecanValue) => void
}): ReactNode {
  const { ctx, section, path, onChange } = props
  const record = props.value && typeof props.value === 'object' && !Array.isArray(props.value) ? (props.value as Record<string, DronecanValue>) : {}
  const named = section.fields.filter((field) => field.n !== null)
  if (named.length === 0) return <p className="can-monitor__dim can-send__no-fields">No fields.</p>
  if (section.union) {
    const active = named.find((field) => field.n! in record) ?? named[0]
    const empty = (desc: DronecanTypeDesc): DronecanValue =>
      'r' in desc ? defaultDronecanValue(ctx.catalogue, ctx.catalogue.section(desc.r, 'msg')) : 'a' in desc ? [] : 'p' in desc && desc.p === 'b' ? false : 0
    return (
      <div className="can-send__union">
        <label className="can-send__field">
          <span className="can-send__field-name">
            one of <small>union</small>
          </span>
          <select
            value={active.n!}
            onChange={(event) => {
              const field = named.find((entry) => entry.n === event.target.value)
              if (field) onChange(path, { [field.n!]: empty(field.t) })
            }}
            data-testid={`${ctx.testIdBase}-${[...path, '$union'].join('.')}`}
          >
            {named.map((field) => (
              <option key={field.n!} value={field.n!}>
                {field.n}
              </option>
            ))}
          </select>
        </label>
        <FieldEditor ctx={ctx} name={active.n!} desc={active.t} value={record[active.n!] ?? empty(active.t)} section={section} path={[...path, active.n!]} onChange={onChange} />
      </div>
    )
  }
  return (
    <>
      {named.map((field) => (
        <FieldEditor key={field.n!} ctx={ctx} name={field.n!} desc={field.t} value={record[field.n!] ?? 0} section={section} path={[...path, field.n!]} onChange={onChange} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------

function HazardNote(props: {
  hazard: CanSendHazard
  raw: boolean
  motionAcknowledged: boolean
  onMotionAcknowledged: (value: boolean) => void
}): ReactNode {
  if (props.hazard === 'motion') {
    return (
      <div className="can-send__hazard can-send__hazard--motion" data-testid="can-send-hazard-motion">
        <p>
          {props.raw
            ? 'A raw frame can command anything on the bus, motors included.'
            : 'This can move something: spin a motor, drive a servo, release a payload.'}
        </p>
        <div className="motor-spin-acks">
          <label>
            <input
              type="checkbox"
              checked={props.motionAcknowledged}
              onChange={(event) => props.onMotionAcknowledged(event.target.checked)}
              data-testid="can-send-props-ack"
            />
            <span>Props off, area clear, craft restrained</span>
          </label>
        </div>
      </div>
    )
  }
  if (props.hazard === 'node') {
    return (
      <div className="can-send__hazard can-send__hazard--node" data-testid="can-send-hazard-node">
        <p>This changes the node: it may restart, erase settings, or start a firmware update. You will be asked to confirm.</p>
      </div>
    )
  }
  return null
}

function statusText(entry: CanSendHistoryEntry): string {
  switch (entry.status) {
    case 'repeating':
      return `repeating every ${entry.periodMs} ms · ${entry.count} sent`
    case 'stopped':
      return `stopped · ${entry.count} sent`
    default:
      return entry.status
  }
}

function HistoryList(props: {
  history: readonly CanSendHistoryEntry[]
  repeatingId: number | undefined
  onStopRepeat: () => void
  onClear: () => void
  nodeLabel: (nodeId: number) => string | undefined
}): ReactNode {
  const [openId, setOpenId] = useState<number | undefined>(undefined)
  if (props.history.length === 0) return null
  return (
    <section className="can-send__history" data-testid="can-send-history">
      <header className="can-send__history-head">
        <h4>Sent</h4>
        <button type="button" className="can-monitor__tool" onClick={props.onClear}>
          Clear
        </button>
      </header>
      <ol>
        {props.history.map((entry) => {
          const tree = entry.response ? transferFieldTree(entry.response) : undefined
          const open = openId === entry.id
          return (
            <li key={entry.id} className={`can-send__sent can-send__sent--${entry.status.replace(' ', '-')}`} data-testid="can-send-history-entry">
              <div className="can-send__sent-row">
                <span className="can-monitor__mono can-monitor__dim">{new Date(entry.atMs).toLocaleTimeString()}</span>
                <strong>{entry.label}</strong>
                <span className="can-monitor__mono can-send__sent-frames">
                  {entry.frames.length > 0
                    ? `${frameId(entry.frames[0])}${entry.frames.length > 1 ? ` · ${entry.frames.length} frames` : ` · ${hex(entry.frames[0].data) || '(no data)'}`}`
                    : ''}
                </span>
                <span className="can-send__status" data-testid="can-send-history-status">
                  {statusText(entry)}
                </span>
                {entry.id === props.repeatingId ? (
                  <button type="button" style={buttonStyle('primary')} onClick={props.onStopRepeat} data-testid="can-send-stop">
                    Stop
                  </button>
                ) : entry.response ? (
                  <button type="button" className="can-monitor__tool" aria-expanded={open} onClick={() => setOpenId(open ? undefined : entry.id)}>
                    {open ? 'Hide reply' : 'Reply'}
                  </button>
                ) : null}
              </div>
              {entry.note ? <p className="can-send__note">{entry.note}</p> : null}
              {open && entry.response ? (
                <div className="can-send__reply" data-testid="can-send-reply">
                  <p className="can-monitor__dim">
                    From node {entry.response.sourceNodeId}
                    {props.nodeLabel(entry.response.sourceNodeId) ? ` ${props.nodeLabel(entry.response.sourceNodeId)}` : ''}
                  </p>
                  {entry.response.problem ? <p className="can-messages__problem">⚠ {entry.response.problem}</p> : null}
                  {tree ? <DronecanFieldTree nodes={tree} /> : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function CanSendView(props: CanSendViewProps): ReactNode {
  const { catalogue, sourceNodeId, blockedReason } = props
  const [draft, setDraftState] = useState<Draft>(lastDraft)
  const setDraft = (change: (current: Draft) => Draft) =>
    setDraftState((current) => {
      const next = change(current)
      lastDraft = next
      return next
    })
  const [confirming, setConfirming] = useState(false)
  const sendable = useMemo(() => canSendableTypes(catalogue), [catalogue])
  const type = draft.typeName ? catalogue.info(draft.typeName) : undefined
  const isService = type?.kind === 'service'
  const section = type ? catalogue.section(type.fullName, isService ? 'req' : 'msg') : undefined
  const value = type ? draft.values[type.fullName] ?? defaultDronecanValue(catalogue, section!) : undefined
  const destination = Number(draft.destination)
  const destinationValid = Number.isInteger(destination) && destination >= 1 && destination <= 127 && draft.destination.trim() !== ''
  const priority = Number(draft.priority)
  const priorityValid = Number.isInteger(priority) && priority >= 0 && priority <= 31
  const periodMs = Number(draft.periodMs)
  const periodValid = Number.isFinite(periodMs) && periodMs >= CAN_SEND_MIN_PERIOD_MS

  // Leaving a type (or a mode) drops a pending confirmation.
  useEffect(() => setConfirming(false), [draft.mode, draft.typeName, draft.destination])

  const raw = parseRawCanFrame(draft.raw)
  const preview = useMemo(() => {
    if (draft.mode !== 'dronecan' || !type || !value || !priorityValid || (isService && !destinationValid)) return undefined
    try {
      return buildDronecanSendFrames(catalogue, {
        fullName: type.fullName,
        kind: isService ? 'request' : 'message',
        value,
        priority,
        sourceNodeId,
        destinationNodeId: isService ? destination : undefined,
        transferId: 0
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [catalogue, draft.mode, type, value, priority, priorityValid, isService, destination, destinationValid, sourceNodeId])

  const hazard: CanSendHazard = draft.mode === 'raw' ? 'motion' : type ? dronecanSendHazard(type.fullName) : undefined
  const ready =
    draft.mode === 'raw' ? raw.ok : preview !== undefined && !('error' in preview)
  const gated = hazard === 'motion' && !props.motionAcknowledged
  const canSend = ready && !blockedReason && !gated
  // Requests are one exchange each; a repeat is for broadcasts and raw frames.
  const canRepeat = canSend && periodValid && !isService && hazard !== 'node'

  const job = (): CanSendJob | undefined => {
    if (draft.mode === 'raw') {
      if (!raw.ok) return undefined
      const frame = raw.value
      return { label: `ID ${frameId(frame)}`, hazard, build: () => [frame] }
    }
    if (!type || !value || type.dataTypeId === null) return undefined
    const spec = {
      fullName: type.fullName,
      kind: isService ? ('request' as const) : ('message' as const),
      value,
      priority,
      sourceNodeId,
      destinationNodeId: isService ? destination : undefined
    }
    return {
      label: isService ? `${type.shortName} → node ${destination}` : type.shortName,
      hazard,
      build: (transferId) => buildDronecanSendFrames(catalogue, { ...spec, transferId }).frames,
      dronecan: {
        counterKey: `${type.fullName}:${isService ? destination : 'all'}`,
        request: isService ? { serviceTypeId: type.dataTypeId, destinationNodeId: destination, sourceNodeId } : undefined
      }
    }
  }

  const sendOnce = () => {
    const next = job()
    if (!next) return
    if (hazard === 'node' && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    props.onSend(next)
  }

  const setValueAt = (path: readonly (string | number)[], next: DronecanValue) => {
    if (!type || !value) return
    setDraft((current) => ({
      ...current,
      values: { ...current.values, [type.fullName]: setDronecanValueAt(value, path, next) as { [field: string]: DronecanValue } }
    }))
  }

  return (
    <section className="can-send" data-testid="can-send">
      <header className="can-plot__bar">
        <h3>
          Send
          <InfoDot label="About sending" wide>
            Puts frames on the forwarded bus through the autopilot, as DroneCAN node {sourceNodeId} (this app). Compose
            any DroneCAN message or service request from the bundled DSDL, or any raw frame. Replies to requests show
            under Sent, and everything sent also appears in Frames and Messages. Repeats stop by themselves when the
            vehicle arms, the bus stops being forwarded, or you leave this page. While disarmed the autopilot may still
            be sending its own commands for the same devices; the device sees both.
          </InfoDot>
        </h3>
        <span className="can-monitor__dim">{props.busLabel ? `On ${props.busLabel} as node ${sourceNodeId}` : 'Not connected to the bus'}</span>
        <div className="can-monitor__segmented" role="radiogroup" aria-label="What to send">
          {(
            [
              ['dronecan', 'DroneCAN'],
              ['raw', 'Raw frame']
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={draft.mode === mode}
              className={draft.mode === mode ? 'is-active' : undefined}
              onClick={() => setDraft((current) => ({ ...current, mode }))}
              data-testid={`can-send-mode-${mode}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {blockedReason ? (
        <p className="can-send__blocked" data-testid="can-send-blocked">
          {blockedReason}
        </p>
      ) : null}

      <div className="can-send__composer">
        {draft.mode === 'dronecan' ? (
          <>
            <div className="can-send__row">
              <label className="can-send__type">
                <span>Type</span>
                <input
                  type="text"
                  list="can-send-types"
                  value={draft.typeName}
                  placeholder="Search: NodeStatus, GetSet, RawCommand…"
                  spellCheck={false}
                  onChange={(event) => setDraft((current) => ({ ...current, typeName: event.target.value.trim() }))}
                  data-testid="can-send-type"
                />
                <datalist id="can-send-types">
                  {sendable.map((entry) => (
                    <option key={entry.fullName} value={entry.fullName}>
                      {entry.kind === 'service' ? 'service' : 'message'} · id {entry.dataTypeId}
                    </option>
                  ))}
                </datalist>
              </label>
              {type ? (
                <span className={`can-messages__kind can-messages__kind--${isService ? 'request' : 'message'}`}>
                  {isService ? 'request' : 'broadcast'} · id {type.dataTypeId}
                </span>
              ) : null}
              {isService ? (
                <label>
                  <span>To node</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    list="can-send-nodes"
                    value={draft.destination}
                    aria-invalid={draft.destination !== '' && !destinationValid}
                    onChange={(event) => setDraft((current) => ({ ...current, destination: event.target.value.trim() }))}
                    className="can-send__short"
                    data-testid="can-send-destination"
                  />
                  <datalist id="can-send-nodes">
                    {props.nodes.map((node) => (
                      <option key={node.nodeId} value={node.nodeId}>
                        {node.label}
                      </option>
                    ))}
                  </datalist>
                </label>
              ) : null}
              <label>
                <span>Priority</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={draft.priority}
                  aria-invalid={!priorityValid}
                  title="0 (highest) … 31 (lowest)"
                  onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value.trim() }))}
                  className="can-send__short"
                  data-testid="can-send-priority"
                />
              </label>
            </div>
            {draft.typeName && !type ? (
              <p className="can-monitor__dim">No type by that name in this build's DSDL.</p>
            ) : null}
            {type && section && value ? (
              <div className="can-send__form" data-testid="can-send-form">
                <SectionEditor ctx={{ catalogue, testIdBase: 'can-send-field' }} section={section} value={value} path={[]} onChange={setValueAt} />
                <button
                  type="button"
                  className="can-monitor__tool can-send__reset"
                  onClick={() =>
                    setDraft((current) => {
                      const values = { ...current.values }
                      delete values[type.fullName]
                      return { ...current, values }
                    })
                  }
                >
                  Reset fields
                </button>
              </div>
            ) : null}
            {isService && !destinationValid ? <p className="can-monitor__dim">Choose the node to ask (1–127).</p> : null}
            {preview ? (
              'error' in preview ? (
                <p className="can-messages__problem">⚠ {preview.error}</p>
              ) : (
                <p className="can-send__preview can-monitor__mono" data-testid="can-send-preview">
                  ID {frameId(preview.frames[0])} · {preview.payload.length} byte{preview.payload.length === 1 ? '' : 's'}
                  {preview.frames.length > 1 ? ` in ${preview.frames.length} frames` : ''} ·{' '}
                  {hex(preview.payload) || '(empty)'}
                </p>
              )
            ) : null}
          </>
        ) : (
          <>
            <div className="can-send__row">
              <label>
                <span>ID (hex)</span>
                <input
                  type="text"
                  value={draft.raw.idText}
                  placeholder={draft.raw.extended ? '1E0A3C7F' : '123'}
                  spellCheck={false}
                  onChange={(event) => setDraft((current) => ({ ...current, raw: { ...current.raw, idText: event.target.value } }))}
                  className="can-send__id"
                  data-testid="can-send-raw-id"
                />
              </label>
              <label className="can-monitor__check">
                <input
                  type="checkbox"
                  checked={draft.raw.extended}
                  onChange={(event) => setDraft((current) => ({ ...current, raw: { ...current.raw, extended: event.target.checked } }))}
                  data-testid="can-send-raw-extended"
                />
                <span>Extended (29-bit)</span>
              </label>
              <label className="can-monitor__check">
                <input
                  type="checkbox"
                  checked={draft.raw.fd}
                  onChange={(event) => setDraft((current) => ({ ...current, raw: { ...current.raw, fd: event.target.checked } }))}
                  data-testid="can-send-raw-fd"
                />
                <span>CAN FD</span>
              </label>
            </div>
            <label className="can-send__data">
              <span>Data (hex, up to {draft.raw.fd ? 64 : 8} bytes)</span>
              <input
                type="text"
                value={draft.raw.dataText}
                placeholder="01 02 FF"
                spellCheck={false}
                onChange={(event) => setDraft((current) => ({ ...current, raw: { ...current.raw, dataText: event.target.value } }))}
                data-testid="can-send-raw-data"
              />
            </label>
            {draft.raw.idText.trim() !== '' && !raw.ok ? <p className="can-messages__problem">⚠ {raw.error}</p> : null}
          </>
        )}

        <HazardNote
          hazard={hazard}
          raw={draft.mode === 'raw'}
          motionAcknowledged={props.motionAcknowledged}
          onMotionAcknowledged={props.onMotionAcknowledged}
        />

        <div className="can-send__actions">
          {confirming ? (
            <>
              <span className="can-send__confirm">
                Send {type?.shortName} to node {destination}?
              </span>
              <button type="button" style={buttonStyle('primary')} onClick={sendOnce} disabled={!canSend} data-testid="can-send-confirm">
                Send it
              </button>
              <button type="button" style={buttonStyle()} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" style={buttonStyle('primary')} onClick={sendOnce} disabled={!canSend} data-testid="can-send-once">
              Send
            </button>
          )}
          {!isService && hazard !== 'node' ? (
            <span className="can-send__repeat">
              <span>every</span>
              <input
                type="text"
                inputMode="numeric"
                value={draft.periodMs}
                aria-label="Repeat period, ms"
                aria-invalid={!periodValid}
                title={`At least ${CAN_SEND_MIN_PERIOD_MS} ms`}
                onChange={(event) => setDraft((current) => ({ ...current, periodMs: event.target.value.trim() }))}
                className="can-send__short"
                data-testid="can-send-period"
              />
              <span>ms</span>
              {props.repeatingId !== undefined ? (
                <button type="button" style={buttonStyle('primary')} onClick={props.onStopRepeat} data-testid="can-send-repeat-stop">
                  Stop repeat
                </button>
              ) : (
                <button
                  type="button"
                  style={buttonStyle()}
                  onClick={() => {
                    const next = job()
                    if (next) props.onStartRepeat(next, periodMs)
                  }}
                  disabled={!canRepeat}
                  data-testid="can-send-repeat"
                >
                  Repeat
                </button>
              )}
            </span>
          ) : null}
          {gated && ready && !blockedReason ? <span className="can-monitor__dim">Tick the safety box to send.</span> : null}
        </div>
      </div>

      <HistoryList
        history={props.history}
        repeatingId={props.repeatingId}
        onStopRepeat={props.onStopRepeat}
        onClear={props.onClearHistory}
        nodeLabel={props.nodeLabel}
      />
    </section>
  )
}
