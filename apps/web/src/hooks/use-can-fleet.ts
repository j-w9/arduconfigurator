// CAN ▸ All devices ▸ Fleet: a parameter set across many nodes, and one
// firmware image flashed to many nodes of one board.
//
// Firmware goes ONE NODE AT A TIME (the runtime serves one update at a time,
// and a whole fleet mid-flash on one bus is a fleet nobody can recover in
// one go). The queue stops at the first failure: the rest stay as they are.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DronecanFirmwareUpdateState, DronecanInspectedNode, DronecanParamValueState } from '@arduconfig/ardupilot-core'

import { formatParamValue } from '../view-models/can-bus'
import type { FleetFirmwareStep } from '../view-models/can-fleet'

export interface FleetBackend {
  applyAndSaveCanBusParameters(nodeId: number, writes: Array<{ name: string; value: DronecanParamValueState }>): Promise<void>
  startCanBusNodeFirmwareUpdate(nodeId: number, fileName: string, image: Uint8Array): Promise<void>
  cancelCanBusNodeFirmwareUpdate(): void
}

export type FleetParamResultState = 'sent' | 'confirmed' | 'unconfirmed' | 'failed'

export interface FleetParamResult {
  nodeId: number
  name: string
  expected: string
  state: FleetParamResultState
  note?: string
}

/** How long a node has to read back the new value before the row says so. */
const PARAM_CONFIRM_TIMEOUT_MS = 15_000

export function useCanFleet(options: {
  backend: FleetBackend | undefined
  nodes: readonly DronecanInspectedNode[]
  firmwareUpdate: DronecanFirmwareUpdateState | undefined
}) {
  const { backend, nodes, firmwareUpdate } = options

  // --- one parameter, many nodes -------------------------------------------
  const [paramResults, setParamResults] = useState<FleetParamResult[]>([])
  const paramSentAt = useRef(0)

  const applyParam = useCallback(
    async (name: string, writes: ReadonlyArray<{ nodeId: number; value: DronecanParamValueState }>) => {
      if (!backend) return
      paramSentAt.current = Date.now()
      setParamResults(writes.map((write) => ({ nodeId: write.nodeId, name, expected: formatParamValue(write.value), state: 'sent' })))
      for (const write of writes) {
        try {
          // Each node: write, save, re-read (the runtime re-walks its params after the save).
          await backend.applyAndSaveCanBusParameters(write.nodeId, [{ name, value: write.value }])
        } catch (error) {
          setParamResults((current) =>
            current.map((row) => (row.nodeId === write.nodeId ? { ...row, state: 'failed', note: error instanceof Error ? error.message : String(error) } : row))
          )
        }
      }
    },
    [backend]
  )

  // A row is confirmed when the node reads back the value; unconfirmed after the timeout.
  useEffect(() => {
    if (!paramResults.some((row) => row.state === 'sent')) return
    const check = () =>
      setParamResults((current) =>
        current.map((row) => {
          if (row.state !== 'sent') return row
          const entry = nodes.find((node) => node.nodeId === row.nodeId)?.parameters.find((param) => param.name === row.name)
          if (entry && formatParamValue(entry.value) === row.expected) return { ...row, state: 'confirmed' }
          if (Date.now() - paramSentAt.current > PARAM_CONFIRM_TIMEOUT_MS) return { ...row, state: 'unconfirmed', note: 'The node did not read back the new value.' }
          return row
        })
      )
    check()
    const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
  }, [nodes, paramResults])

  // --- one image, many nodes -----------------------------------------------
  const [firmwareSteps, setFirmwareSteps] = useState<FleetFirmwareStep[]>([])
  const image = useRef<{ fileName: string; bytes: Uint8Array } | undefined>(undefined)
  // When the current node's update was started: an older finished update of
  // the same node (still on the runtime's state) must not count as this one.
  const stepStartedAt = useRef(0)
  const firmwareRunning = firmwareSteps.some((step) => step.state === 'waiting' || step.state === 'updating')

  const startNext = useCallback(
    (steps: FleetFirmwareStep[]): FleetFirmwareStep[] => {
      const next = steps.findIndex((step) => step.state === 'waiting')
      if (next < 0 || !backend || !image.current) return steps
      const nodeId = steps[next].nodeId
      stepStartedAt.current = Date.now() - 50
      void backend.startCanBusNodeFirmwareUpdate(nodeId, image.current.fileName, image.current.bytes)
      return steps.map((step, index) => (index === next ? { ...step, state: 'updating' } : step))
    },
    [backend]
  )

  const startFirmware = useCallback(
    (nodeIds: readonly number[], fileName: string, bytes: Uint8Array) => {
      image.current = { fileName, bytes }
      setFirmwareSteps(startNext(nodeIds.map((nodeId) => ({ nodeId, state: 'waiting' }))))
    },
    [startNext]
  )

  // Follow the runtime's single update: when the node being updated finishes,
  // start the next; on a failure, stop the queue.
  useEffect(() => {
    const current = firmwareSteps.find((step) => step.state === 'updating')
    if (!current || !firmwareUpdate || firmwareUpdate.nodeId !== current.nodeId) return
    if (firmwareUpdate.startedAtMs < stepStartedAt.current) return
    if (firmwareUpdate.status === 'completed') {
      setFirmwareSteps((steps) => startNext(steps.map((step) => (step.nodeId === current.nodeId && step.state === 'updating' ? { ...step, state: 'done' } : step))))
    } else if (firmwareUpdate.status === 'error') {
      setFirmwareSteps((steps) =>
        steps.map((step) =>
          step.nodeId === current.nodeId && step.state === 'updating'
            ? { ...step, state: 'failed', note: firmwareUpdate.error }
            : step.state === 'waiting'
              ? { ...step, state: 'skipped', note: 'Not started: an earlier node failed.' }
              : step
        )
      )
    }
  }, [firmwareSteps, firmwareUpdate, startNext])

  const cancelFirmware = useCallback(() => {
    backend?.cancelCanBusNodeFirmwareUpdate()
    setFirmwareSteps((steps) =>
      steps.map((step) =>
        step.state === 'updating'
          ? { ...step, state: 'failed', note: 'Cancelled.' }
          : step.state === 'waiting'
            ? { ...step, state: 'skipped', note: 'Cancelled.' }
            : step
      )
    )
  }, [backend])

  const clearFirmware = useCallback(() => setFirmwareSteps([]), [])

  return { paramResults, applyParam, clearParamResults: () => setParamResults([]), firmwareSteps, firmwareRunning, startFirmware, cancelFirmware, clearFirmware }
}
