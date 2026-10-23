import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * A small in-card log of what the flasher did, so a user whose flash failed
 * can copy it to the maintainer without opening the browser console. The
 * `[flash]` / `[dfu]` console lines stay; this is a second sink for them.
 *
 * Ring buffer of at most MAX_LINES lines, held in React state so the view
 * re-renders as lines land. `append` is referentially stable (it reads the
 * buffer through a ref) so it can be handed to closures and child components
 * without re-wiring them on every line.
 */
export const MAX_FLASH_DEBUG_LINES = 500

export interface FlashDebugLog {
  lines: readonly string[]
  append: (msg: string, ...args: unknown[]) => void
  clear: () => void
  /** All lines joined with newlines (no header; the view adds one on copy). */
  text: string
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function timestamp(now: Date): string {
  return `${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}.${pad(now.getMilliseconds(), 3)}`
}

/**
 * JSON.stringify that never throws: Errors become name + message, byte
 * arrays become their length (a 1 MB image is not a log line), and a
 * circular reference becomes "[object]".
 */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const replacer = (_key: string, v: unknown): unknown => {
    if (v instanceof Error) return `${v.name}: ${v.message}`
    if (v instanceof Uint8Array) return `<${v.length} bytes>`
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[object]'
      seen.add(v)
    }
    return v
  }
  try {
    // Top-level Error/Uint8Array never reach the replacer's value branch the
    // same way nested ones do (JSON calls it with key "" first), so handle
    // them explicitly for a clean one-liner.
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (value instanceof Uint8Array) return `<${value.length} bytes>`
    const out = JSON.stringify(value, replacer)
    return out === undefined ? String(value) : out
  } catch {
    return '[object]'
  }
}

export function formatFlashDebugLine(msg: string, args: readonly unknown[], now: Date = new Date()): string {
  const detail = args.length === 0 ? '' : ` ${args.map(safeStringify).join(' ')}`
  return `${timestamp(now)} ${msg}${detail}`
}

export function useFlashDebugLog(): FlashDebugLog {
  const [lines, setLines] = useState<readonly string[]>([])
  const linesRef = useRef<readonly string[]>([])

  const append = useCallback((msg: string, ...args: unknown[]) => {
    const line = formatFlashDebugLine(msg, args)
    const next = linesRef.current.length >= MAX_FLASH_DEBUG_LINES
      ? [...linesRef.current.slice(linesRef.current.length - MAX_FLASH_DEBUG_LINES + 1), line]
      : [...linesRef.current, line]
    linesRef.current = next
    setLines(next)
  }, [])

  const clear = useCallback(() => {
    linesRef.current = []
    setLines([])
  }, [])

  const text = useMemo(() => lines.join('\n'), [lines])

  return { lines, append, clear, text }
}
