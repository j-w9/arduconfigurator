// Serial baud-rate input helpers, extracted from App.tsx as part of its
// decomposition. The Ports tab lets the operator type a custom baud or pick a
// preset; these parse/format/classify those values. No React, no app state.

import { arducopterSerialBaudRate, encodeArducopterSerialBaud } from '@arduconfig/param-metadata'

export const SERIAL_BAUD_PRESET_RATES = [9600, 19200, 38400, 57600, 100000, 111100, 115200, 230400, 256000, 460800, 500000, 921600, 1200000, 1500000, 2000000, 12500000] as const

export function formatBaudRate(baudRate: number | undefined): string {
  return baudRate === undefined ? 'Unknown' : `${baudRate.toLocaleString()} baud`
}

export function parseSerialBaudInput(rawValue: string): { encodedValue?: number; baudRate?: number } {
  const parsed = Number(rawValue.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {}
  }

  const normalized = Math.round(parsed)
  const baudRate = arducopterSerialBaudRate(normalized > 2000 ? normalized : normalized)
  const resolvedBaudRate = normalized > 2000 ? normalized : baudRate
  return {
    baudRate: resolvedBaudRate,
    encodedValue: encodeArducopterSerialBaud(resolvedBaudRate)
  }
}

export function isPresetBaudRate(baudRate: number | undefined): boolean {
  return baudRate !== undefined && SERIAL_BAUD_PRESET_RATES.includes(baudRate as (typeof SERIAL_BAUD_PRESET_RATES)[number])
}

export function selectedBaudPresetValue(baudRate: number | undefined): string {
  return isPresetBaudRate(baudRate) ? String(baudRate) : 'custom'
}
