import { useState } from 'react'

import type { DronecanParamValueState } from '@arduconfig/ardupilot-core'
import { buttonStyle } from '@arduconfig/ui-kit'

import {
  endpointLabel,
  intValueLike,
  isUartEndpoint,
  type EndpointOption,
  type PassthroughBlock
} from '../view-models/passthrough'

export interface PassthroughEditorProps {
  nodeId: number
  nodeName: string
  blocks: PassthroughBlock[]
  /** Endpoints this node actually exposes (derived from its params), not the
   *  full serial-manager range — so the dropdowns don't list ports it lacks. */
  endpointOptions: EndpointOption[]
  busy: boolean
  onApplyAndSave: (nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>) => void
}

/**
 * Product-shaped editor for a DroneNet/AP_Periph node's serial↔network
 * passthrough (NET_PASSn_*): each bridge is one row with labelled endpoint
 * dropdowns ("Serial 2 ⇄ Network port 1") instead of raw endpoint-ID numbers.
 * Manages its own drafts and writes them over DroneCAN via the shared
 * apply-and-save path; the node reboots on apply.
 */
export function PassthroughEditor({ nodeId, nodeName, blocks, endpointOptions, busy, onApplyAndSave }: PassthroughEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  if (blocks.length === 0) {
    return null
  }

  const setDraft = (name: string, value: string): void => setDrafts((current) => ({ ...current, [name]: value }))

  // Current numeric value of a block field: the draft (keyed by param name) if
  // edited, otherwise the live value read from the block.
  const current = (block: PassthroughBlock, suffix: string, live: number | undefined): number | undefined => {
    const name = block.entries[suffix]?.name
    if (name !== undefined && drafts[name] !== undefined) {
      const parsed = Number(drafts[name])
      return Number.isNaN(parsed) ? undefined : parsed
    }
    return live
  }

  const draftCount = Object.keys(drafts).length

  const apply = (): void => {
    const entryByName = new Map(blocks.flatMap((block) => Object.values(block.entries)).map((entry) => [entry.name, entry]))
    const writes = Object.entries(drafts).flatMap(([name, value]) => {
      const entry = entryByName.get(name)
      const parsed = Number(value)
      if (entry === undefined || Number.isNaN(parsed)) {
        return []
      }
      return [{ name, value: intValueLike(entry.value, parsed) }]
    })
    if (writes.length === 0) {
      return
    }
    onApplyAndSave(nodeId, writes)
    setDrafts({})
  }

  return (
    <div className="scoped-review-card scoped-review-card--compact" data-testid={`passthrough-editor-${nodeId}`}>
      <div className="switch-exercise-card__header">
        <div>
          <strong>Passthrough bridges</strong>
          <p>
            Bridge two of {nodeName}&apos;s endpoints into one bidirectional link — e.g. expose a node UART as a
            TCP/UDP socket on the LAN. The node reboots when you apply.
          </p>
        </div>
      </div>
      <div className="passthrough-list">
        {blocks.map((block) => {
          const enableName = block.entries.ENABLE?.name
          const enabled = (current(block, 'ENABLE', block.enable) ?? 0) !== 0
          const ep1 = current(block, 'EP1', block.ep1) ?? 0
          const ep2 = current(block, 'EP2', block.ep2) ?? 0
          const showBaud1 = isUartEndpoint(ep1) && block.entries.BAUD1 !== undefined
          const showBaud2 = isUartEndpoint(ep2) && block.entries.BAUD2 !== undefined
          return (
            <div className="passthrough-row" key={block.index} data-testid={`passthrough-row-${nodeId}-${block.index}`}>
              <label className="passthrough-row__enable">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={enableName === undefined}
                  onChange={(event) => enableName && setDraft(enableName, event.target.checked ? '1' : '0')}
                  data-testid={`passthrough-enable-${nodeId}-${block.index}`}
                />
                <span>Bridge {block.index}</span>
              </label>
              <div className="passthrough-row__endpoints">
                <select
                  value={String(ep1)}
                  disabled={block.entries.EP1 === undefined}
                  onChange={(event) => block.entries.EP1 && setDraft(block.entries.EP1.name, event.target.value)}
                  data-testid={`passthrough-ep1-${nodeId}-${block.index}`}
                >
                  {endpointOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="passthrough-row__link" aria-hidden="true">⇄</span>
                <select
                  value={String(ep2)}
                  disabled={block.entries.EP2 === undefined}
                  onChange={(event) => block.entries.EP2 && setDraft(block.entries.EP2.name, event.target.value)}
                  data-testid={`passthrough-ep2-${nodeId}-${block.index}`}
                >
                  {endpointOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {showBaud1 || showBaud2 ? (
                <div className="passthrough-row__baud">
                  {showBaud1 && block.entries.BAUD1 ? (
                    <label>
                      <span>{endpointLabel(ep1)} baud</span>
                      <input
                        type="number"
                        value={String(current(block, 'BAUD1', block.baud1) ?? '')}
                        onChange={(event) => setDraft(block.entries.BAUD1!.name, event.target.value)}
                      />
                    </label>
                  ) : null}
                  {showBaud2 && block.entries.BAUD2 ? (
                    <label>
                      <span>{endpointLabel(ep2)} baud</span>
                      <input
                        type="number"
                        value={String(current(block, 'BAUD2', block.baud2) ?? '')}
                        onChange={(event) => setDraft(block.entries.BAUD2!.name, event.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="switch-exercise-controls">
        <button type="button" style={buttonStyle('primary')} onClick={apply} disabled={busy || draftCount === 0}>
          Apply passthrough ({draftCount})
        </button>
        <button type="button" style={buttonStyle()} onClick={() => setDrafts({})} disabled={busy || draftCount === 0}>
          Discard
        </button>
      </div>
    </div>
  )
}
