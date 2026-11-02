// Which USB device a board's bootloader shows up as, by board id. On many
// boards (ChibiOS bootloaders) it is a different USB device from the
// firmware's, which Web Serial can only reach once the operator has picked
// it in the browser's port picker -- after that Chrome remembers the grant,
// and the flasher's connect-event / port poll catch it on a replug by
// themselves. Remembering that we have caught this board's bootloader
// before lets the replug flow skip the picker. Pure; the flasher stores it.

export interface UsbIds {
  vendorId: number
  productId: number
}

export type BootloaderPortMemory = Readonly<Record<string, UsbIds>>

export const BOOTLOADER_PORT_MEMORY_KEY = 'arduconfig-bootloader-ports'

export function parseBootloaderPortMemory(json: string | null | undefined): BootloaderPortMemory {
  if (!json) return {}
  try {
    const stored = JSON.parse(json) as Record<string, unknown>
    const memory: Record<string, UsbIds> = {}
    for (const [boardId, ids] of Object.entries(stored ?? {})) {
      const entry = ids as Partial<UsbIds> | null
      if (/^\d+$/.test(boardId) && Number.isInteger(entry?.vendorId) && Number.isInteger(entry?.productId)) {
        memory[boardId] = { vendorId: entry!.vendorId!, productId: entry!.productId! }
      }
    }
    return memory
  } catch {
    return {}
  }
}

/** Note the device a board's bootloader was caught on. */
export function rememberBootloaderPort(memory: BootloaderPortMemory, boardId: number, ids: UsbIds | undefined): BootloaderPortMemory {
  if (!ids || !Number.isInteger(boardId) || boardId <= 0) return memory
  const known = memory[String(boardId)]
  if (known && known.vendorId === ids.vendorId && known.productId === ids.productId) return memory
  return { ...memory, [String(boardId)]: ids }
}

/** The device this board's bootloader was caught on before, if any. */
export function knownBootloaderPort(memory: BootloaderPortMemory, boardId: number | undefined): UsbIds | undefined {
  return boardId === undefined ? undefined : memory[String(boardId)]
}

export function formatUsbIds(ids: UsbIds): string {
  const hex = (value: number) => value.toString(16).padStart(4, '0')
  return `${hex(ids.vendorId)}:${hex(ids.productId)}`
}
