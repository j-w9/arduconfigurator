// CAN ▸ All devices ▸ Fleet: set one parameter on many nodes, and flash one
// firmware image to many nodes of one board. Dumb view; App owns the state.

import { useMemo, useState, type ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'
import type { DronecanFirmwareUpdateState, DronecanInspectedNode, DronecanParamValueState } from '@arduconfig/ardupilot-core'
import { dronecanNodeBoardId } from '@arduconfig/firmware-flash'

import { EnumPicker } from './EnumPicker'
import { formatParamValue } from '../view-models/can-bus'
import type { DronecanParamCatalogLookup } from '../view-models/dronecan-param-display'
import {
  buildFleetParamOptions,
  buildFleetParamPlan,
  fleetFirmwareCandidates,
  fleetFirmwareCheck,
  fleetParamWrites,
  type FleetFirmwareStep
} from '../view-models/can-fleet'
import type { FleetParamResult } from '../hooks/use-can-fleet'

export interface CanFleetViewProps {
  nodes: readonly DronecanInspectedNode[]
  /** The autopilot's own node ids: never part of a fleet change. */
  selfNodeIds: readonly number[]
  nodeLabel: (nodeId: number) => string
  paramMetadata: DronecanParamCatalogLookup
  /** Why changes are off (armed, bus down); undefined when they can run. */
  blockedReason?: string
  paramResults: readonly FleetParamResult[]
  onApplyParam: (name: string, writes: Array<{ nodeId: number; value: DronecanParamValueState }>) => void
  /** Firmware is Expert-only; absent hides the firmware half. */
  firmware?: {
    steps: readonly FleetFirmwareStep[]
    running: boolean
    current: DronecanFirmwareUpdateState | undefined
    onStart: (nodeIds: number[], fileName: string, image: Uint8Array) => void
    onCancel: () => void
    onClear: () => void
  }
}

const STATE_LABEL: Record<string, string> = {
  change: 'will change',
  same: 'already set',
  invalid: 'not a valid value',
  missing: 'no such parameter',
  sent: 'writing…',
  confirmed: '✓ set',
  unconfirmed: 'not confirmed',
  failed: 'failed',
  waiting: 'waiting',
  updating: 'updating',
  done: '✓ updated',
  skipped: 'not started'
}

function FleetParams(props: CanFleetViewProps): ReactElement {
  const nodes = useMemo(() => props.nodes.filter((node) => !props.selfNodeIds.includes(node.nodeId)), [props.nodes, props.selfNodeIds])
  const options = useMemo(() => buildFleetParamOptions(nodes), [nodes])
  const [name, setName] = useState<string | undefined>(undefined)
  const option = options.find((candidate) => candidate.name === name)
  const [deselected, setDeselected] = useState<ReadonlySet<number>>(new Set())
  const selected = option ? option.nodeIds.filter((nodeId) => !deselected.has(nodeId)) : []
  const [raw, setRaw] = useState('')
  const plan = option ? buildFleetParamPlan(nodes, selected, option.name, raw) : []
  const writes = fleetParamWrites(plan)
  const firstNode = option ? nodes.find((node) => node.nodeId === option.nodeIds[0]) : undefined
  const meta = option ? props.paramMetadata(option.name, firstNode) : undefined
  const named = meta?.options && meta.options.length > 0 && !meta.bitmask ? meta.options : undefined
  const resultFor = (nodeId: number) => props.paramResults.find((row) => row.nodeId === nodeId && row.name === option?.name)

  if (options.length === 0) {
    return <p className="can-fleet__empty">Read the nodes&apos; parameters first (Params on each node).</p>
  }
  return (
    <div className="can-fleet__section" data-testid="can-fleet-params">
      <h4>Set a parameter on several nodes</h4>
      <div className="can-fleet__row">
        <label className="can-fleet__field">
          <span>Parameter</span>
          <EnumPicker
            value={option ? String(options.indexOf(option)) : ''}
            options={options.map((candidate, index) => ({ value: index, label: `${candidate.name} · ${candidate.nodeIds.length} node${candidate.nodeIds.length === 1 ? '' : 's'}` }))}
            onChange={(next) => {
              setName(options[Number(next)]?.name)
              setDeselected(new Set())
              setRaw('')
            }}
            ariaLabel="Parameter"
            testId="can-fleet-param"
          />
        </label>
        {option ? (
          <label className="can-fleet__field">
            <span>New value</span>
            {named ? (
              <EnumPicker value={raw} options={named} onChange={setRaw} ariaLabel="New value" testId="can-fleet-value-select" />
            ) : (
              <input type="text" value={raw} onChange={(event) => setRaw(event.target.value)} data-testid="can-fleet-value" />
            )}
          </label>
        ) : null}
      </div>
      {option ? (
        <>
          {meta?.label && meta.label !== option.name ? <p className="can-fleet__hint">{meta.label}</p> : null}
          <table className="can-fleet__table">
            <thead>
              <tr>
                <th />
                <th>Node</th>
                <th>Now</th>
                <th>New</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {option.nodeIds.map((nodeId) => {
                const row = plan.find((candidate) => candidate.nodeId === nodeId)
                const result = resultFor(nodeId)
                const included = !deselected.has(nodeId)
                const current = nodes.find((node) => node.nodeId === nodeId)?.parameters.find((param) => param.name === option.name)
                return (
                  <tr key={nodeId} data-testid={`can-fleet-param-row-${nodeId}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(event) =>
                          setDeselected((was) => {
                            const next = new Set(was)
                            if (event.target.checked) next.delete(nodeId)
                            else next.add(nodeId)
                            return next
                          })
                        }
                        aria-label={`Include node ${nodeId}`}
                        data-testid={`can-fleet-param-include-${nodeId}`}
                      />
                    </td>
                    <td>{props.nodeLabel(nodeId)}</td>
                    <td>{row?.currentLabel ?? formatParamValue(current?.value)}</td>
                    <td>{included && raw.trim() !== '' ? row?.nextLabel ?? '—' : '—'}</td>
                    <td data-testid={`can-fleet-param-state-${nodeId}`}>
                      {result ? STATE_LABEL[result.state] : included && raw.trim() !== '' && row ? STATE_LABEL[row.state] : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="can-fleet__actions">
            <button
              type="button"
              style={buttonStyle('primary')}
              disabled={writes.length === 0 || props.blockedReason !== undefined}
              onClick={() => props.onApplyParam(option.name, writes)}
              data-testid="can-fleet-param-apply"
            >
              Set on {writes.length} node{writes.length === 1 ? '' : 's'}
            </button>
            <small>{props.blockedReason ?? 'Each node writes, saves and reads it back.'}</small>
          </div>
        </>
      ) : null}
    </div>
  )
}

function FleetFirmware(props: CanFleetViewProps & { firmware: NonNullable<CanFleetViewProps['firmware']> }): ReactElement {
  const { firmware } = props
  const candidates = useMemo(() => fleetFirmwareCandidates(props.nodes, props.selfNodeIds), [props.nodes, props.selfNodeIds])
  const [selected, setSelected] = useState<number[]>([])
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | undefined>(undefined)
  const [readError, setReadError] = useState<string | undefined>(undefined)
  const [acknowledged, setAcknowledged] = useState(false)
  const check = fleetFirmwareCheck(props.nodes, selected)
  const stepFor = (nodeId: number) => firmware.steps.find((step) => step.nodeId === nodeId)
  const blocked = props.blockedReason ?? (!check.ok ? check.reason : !file ? 'Choose the firmware file.' : !acknowledged ? 'Tick the box first.' : undefined)

  if (candidates.length === 0) {
    return <p className="can-fleet__empty">No node has said which board it is yet.</p>
  }
  return (
    <div className="can-fleet__section" data-testid="can-fleet-firmware">
      <h4>Update firmware on several nodes</h4>
      <p className="can-fleet__hint">One image, nodes of one board, one node at a time. The queue stops at the first failure.</p>
      <table className="can-fleet__table">
        <thead>
          <tr>
            <th />
            <th>Node</th>
            <th>Board</th>
            <th>Version</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((node) => {
            const step = stepFor(node.nodeId)
            const live = firmware.current && firmware.current.nodeId === node.nodeId && step?.state === 'updating'
            const percent = live && firmware.current!.fileSize > 0 ? Math.round((firmware.current!.bytesServed / firmware.current!.fileSize) * 100) : undefined
            return (
              <tr key={node.nodeId} data-testid={`can-fleet-fw-row-${node.nodeId}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(node.nodeId)}
                    disabled={firmware.running}
                    onChange={(event) =>
                      setSelected((was) => (event.target.checked ? [...was, node.nodeId] : was.filter((nodeId) => nodeId !== node.nodeId)))
                    }
                    aria-label={`Update node ${node.nodeId}`}
                    data-testid={`can-fleet-fw-include-${node.nodeId}`}
                  />
                </td>
                <td>{props.nodeLabel(node.nodeId)}</td>
                <td>{dronecanNodeBoardId(node.hwVersion)}</td>
                <td>{node.swVersion ? `${node.swVersion.major}.${node.swVersion.minor}` : '—'}</td>
                <td data-testid={`can-fleet-fw-state-${node.nodeId}`} title={step?.note}>
                  {step ? `${STATE_LABEL[step.state]}${percent !== undefined ? ` ${percent}%` : ''}${step.note && step.state !== 'skipped' ? ` · ${step.note}` : ''}` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="can-fleet__row">
        <label className="can-fleet__field">
          <span>Firmware (.bin)</span>
          <input
            type="file"
            accept=".bin"
            disabled={firmware.running}
            onChange={(event) => {
              const picked = event.target.files?.[0]
              setReadError(undefined)
              if (!picked) {
                setFile(undefined)
                return
              }
              picked
                .arrayBuffer()
                .then((buffer) => setFile({ name: picked.name, bytes: new Uint8Array(buffer) }))
                .catch(() => setReadError('Could not read the selected file.'))
            }}
            data-testid="can-fleet-fw-file"
          />
        </label>
      </div>
      {readError ? <p className="can-fleet__error">{readError}</p> : null}
      <label className="can-fleet__ack">
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} data-testid="can-fleet-fw-ack" />
        <span>This firmware is right for every node ticked. I will keep the bus powered until they are all done.</span>
      </label>
      <div className="can-fleet__actions">
        {firmware.running ? (
          <button type="button" style={buttonStyle()} onClick={firmware.onCancel} data-testid="can-fleet-fw-cancel">
            Cancel
          </button>
        ) : (
          <button
            type="button"
            style={buttonStyle('primary')}
            disabled={blocked !== undefined}
            onClick={() => file && firmware.onStart([...selected].sort((a, b) => a - b), file.name, file.bytes)}
            data-testid="can-fleet-fw-start"
          >
            Update {selected.length} node{selected.length === 1 ? '' : 's'}
          </button>
        )}
        {!firmware.running && firmware.steps.length > 0 ? (
          <button type="button" style={buttonStyle()} onClick={firmware.onClear}>
            Clear
          </button>
        ) : null}
        <small data-testid="can-fleet-fw-blocked">{firmware.running ? 'Updating… keep the bus powered.' : blocked ?? ''}</small>
      </div>
    </div>
  )
}

export function CanFleetView(props: CanFleetViewProps): ReactElement {
  return (
    <section className="can-fleet" data-testid="can-fleet">
      <h3>Fleet</h3>
      <FleetParams {...props} />
      {props.firmware ? <FleetFirmware {...props} firmware={props.firmware} /> : null}
    </section>
  )
}
