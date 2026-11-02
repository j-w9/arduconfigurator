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
// Lines are short; a long listen phase (two lines per failed identify, on a
// 100 ms poll) reached the old cap of 500 and rolled the start of the flash
// off the top of a field report.
export const MAX_FLASH_DEBUG_LINES = 5000

export interface FlashDebugLog {
  lines: readonly string[]
  append: (msg: string, ...args: unknown[]) => void
  clear: () => void
  /** All lines joined with newlines (no header; the view adds one on copy). */
  text: string
  /** Lines dropped off the top once the buffer was full. */
  dropped: number
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/** "HH:MM:SS.mmm " — what formatFlashDebugLine puts before the message. */
const TIMESTAMP_LENGTH = 13

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

  const droppedRef = useRef(0)
  const [dropped, setDropped] = useState(0)
  // The previous line without its timestamp, and how many times in a row it
  // has repeated: a poll that logs the same thing every tick becomes one line
  // with a count, not a page of them.
  const lastBodyRef = useRef<string | undefined>(undefined)
  const repeatRef = useRef(1)

  const append = useCallback((msg: string, ...args: unknown[]) => {
    const line = formatFlashDebugLine(msg, args)
    const body = line.slice(TIMESTAMP_LENGTH)
    let next: string[]
    if (body === lastBodyRef.current && linesRef.current.length > 0) {
      repeatRef.current += 1
      next = [...linesRef.current.slice(0, -1), `${line} ×${repeatRef.current}`]
    } else {
      lastBodyRef.current = body
      repeatRef.current = 1
      if (linesRef.current.length >= MAX_FLASH_DEBUG_LINES) {
        droppedRef.current += 1
        setDropped(droppedRef.current)
        next = [...linesRef.current.slice(1), line]
      } else {
        next = [...linesRef.current, line]
      }
    }
    linesRef.current = next
    setLines(next)
  }, [])

  const clear = useCallback(() => {
    linesRef.current = []
    lastBodyRef.current = undefined
    repeatRef.current = 1
    droppedRef.current = 0
    setDropped(0)
    setLines([])
  }, [])

  const text = useMemo(() => lines.join('\n'), [lines])

  return { lines, append, clear, text, dropped }
}

/**
 * The browser and OS in plain words, from the user-agent string: every
 * browser's string starts with "Mozilla/5.0" for 1990s-compatibility
 * reasons, and the real name sits near the end. Brave and others report
 * themselves as Chrome, so this is the engine the page ran in, not the
 * brand on the icon.
 */
export function describeUserAgent(userAgent: string): string {
  const browser =
    /\bEdg\/(\d+)/.exec(userAgent)?.[1] !== undefined
      ? `Edge ${/\bEdg\/(\d+)/.exec(userAgent)![1]}`
      : /\bOPR\/(\d+)/.exec(userAgent)?.[1] !== undefined
        ? `Opera ${/\bOPR\/(\d+)/.exec(userAgent)![1]}`
        : /\bChrome\/(\d+)/.exec(userAgent)?.[1] !== undefined
          ? `Chrome ${/\bChrome\/(\d+)/.exec(userAgent)![1]}`
          : /\bFirefox\/(\d+)/.exec(userAgent)?.[1] !== undefined
            ? `Firefox ${/\bFirefox\/(\d+)/.exec(userAgent)![1]}`
            : /\bVersion\/(\d+)[^)]*Safari/.exec(userAgent)?.[1] !== undefined
              ? `Safari ${/\bVersion\/(\d+)/.exec(userAgent)![1]}`
              : 'unknown browser'
  const os = /Windows NT/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /CrOS/.test(userAgent)
            ? 'ChromeOS'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : 'unknown OS'
  return `${browser}, ${os}`
}
