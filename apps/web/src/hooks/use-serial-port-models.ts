// Serial-port view-model derivations factored out of App.tsx. The Ports tab
// builds per-port view models from the snapshot + board catalog, computes which
// ports are "prioritized" (already configured, or pending a draft change),
// filters down to the visible set (unless the operator expands all slots), and
// derives the receiver / VTX / OSD protocol link-port subsets. Output values
// are byte-identical to the inline App.tsx originals.

import { useMemo } from 'react'

import type { ConfiguratorSnapshot, ParameterDraftEntry } from '@arduconfig/ardupilot-core'
import type { BoardCatalogEntry } from '@arduconfig/param-metadata'

import {
  buildSerialPortViewModels,
  isOsdSerialProtocol,
  isReceiverSerialProtocol,
  isVtxControlSerialProtocol,
  parseSerialPortNumber
} from '../serial-port-helpers'

export function useSerialPortModels(input: {
  snapshot: ConfiguratorSnapshot
  boardCatalogEntry: BoardCatalogEntry | undefined
  portsDraftEntries: ParameterDraftEntry[]
  showAllSerialPorts: boolean
}) {
  const { snapshot, boardCatalogEntry, portsDraftEntries, showAllSerialPorts } = input

  const serialPortViewModels = useMemo(
    () => buildSerialPortViewModels(snapshot, boardCatalogEntry),
    [snapshot, boardCatalogEntry]
  )
  const prioritizedSerialPortNumbers = useMemo(() => {
    const portNumbers = new Set<number>()

    serialPortViewModels.forEach((port) => {
      if (port.protocolValue !== undefined && port.protocolValue !== 0 && port.protocolValue !== -1) {
        portNumbers.add(port.portNumber)
      }
    })

    portsDraftEntries.forEach((entry) => {
      if (entry.status === 'unchanged') {
        return
      }

      const portNumber = parseSerialPortNumber(entry.id)
      if (portNumber !== undefined) {
        portNumbers.add(portNumber)
      }
    })

    return [...portNumbers].sort((left, right) => left - right)
  }, [portsDraftEntries, serialPortViewModels])
  const visibleSerialPortViewModels = useMemo(() => {
    if (showAllSerialPorts) {
      return serialPortViewModels
    }

    const visiblePorts = serialPortViewModels.filter((port) => prioritizedSerialPortNumbers.includes(port.portNumber))
    return visiblePorts.length > 0 ? visiblePorts : serialPortViewModels.slice(0, Math.min(serialPortViewModels.length, 4))
  }, [prioritizedSerialPortNumbers, serialPortViewModels, showAllSerialPorts])
  const hiddenSerialPortCount = serialPortViewModels.length - visibleSerialPortViewModels.length

  const receiverLinkPorts = useMemo(
    () => serialPortViewModels.filter((port) => isReceiverSerialProtocol(port.protocolValue)),
    [serialPortViewModels]
  )
  const vtxLinkPorts = useMemo(
    () => serialPortViewModels.filter((port) => isVtxControlSerialProtocol(port.protocolValue)),
    [serialPortViewModels]
  )
  const osdLinkPorts = useMemo(
    () => serialPortViewModels.filter((port) => isOsdSerialProtocol(port.protocolValue)),
    [serialPortViewModels]
  )

  return {
    serialPortViewModels,
    prioritizedSerialPortNumbers,
    visibleSerialPortViewModels,
    hiddenSerialPortCount,
    receiverLinkPorts,
    vtxLinkPorts,
    osdLinkPorts
  }
}
