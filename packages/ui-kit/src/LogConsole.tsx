import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

import { Panel, buttonStyle } from './index.js'

// A scrolling console for a long operation: a flash, a settings read, a probe
// sweep. It follows new lines, and stops following the moment the reader
// scrolls up to look at something — without that, a log is unreadable exactly
// when it matters, because the line you are reading leaves the viewport.
//
// Copy and Download are not decoration: what went wrong on someone else's
// bench arrives as a pasted log, and a device session that is not written down
// did not happen.

const DEFAULT_MAX_LINES = 5000

export interface LogLines {
  lines: string[]
  /** Exactly the `(line: string) => void` shape device libraries log through. */
  append: (line: string) => void
  clear: () => void
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

/**
 * Append one logged string to the lines already held, and enforce the cap.
 *
 * Pure, and exported so the two things that are easy to get wrong can be
 * tested without a DOM: a library that logs a multi-line block must become one
 * timestamped line per line rather than one line with newlines buried in it,
 * and the cap must drop from the FRONT, because the end of a flash is the part
 * worth keeping.
 */
export function appendLogLines(
  previous: readonly string[],
  line: string,
  maxLines: number = DEFAULT_MAX_LINES,
  at: string = stamp()
): string[] {
  const stamped = line
    .split('\n')
    .filter((one) => one.length > 0)
    .map((one) => `${at}  ${one}`)
  if (stamped.length === 0) return previous as string[]
  const next = previous.concat(stamped)
  return next.length > maxLines ? next.slice(next.length - maxLines) : next
}

/**
 * One log for a page. `append` is passed straight to a device library as its
 * log callback, so what the page shows is what that library's CLI would have
 * printed.
 *
 * Lines are capped: a flash that retries can emit a great many, and an
 * unbounded array is a tab that dies mid-operation.
 */
export function useLogLines(maxLines: number = DEFAULT_MAX_LINES): LogLines {
  const [lines, setLines] = useState<string[]>([])
  const append = useCallback(
    (line: string) => {
      setLines((prev) => appendLogLines(prev, line, maxLines))
    },
    [maxLines]
  )
  const clear = useCallback(() => setLines([]), [])
  return useMemo(() => ({ lines, append, clear }), [lines, append, clear])
}

const preStyle: CSSProperties = {
  margin: 0,
  minHeight: 160,
  maxHeight: 360,
  overflow: 'auto',
  padding: 'var(--space-3, 12px)',
  borderRadius: 'var(--radius-md, 6px)',
  border: '1px solid var(--border-soft, #333333)',
  background: 'var(--bg-panel-soft, #242424)',
  color: 'var(--text, #f2f2f2)',
  fontFamily: 'var(--font-data, ui-monospace, monospace)',
  fontSize: 'var(--text-sm, 0.8125rem)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word'
}

export interface LogConsoleProps {
  log: LogLines
  title?: string
  subtitle?: string
  /** Stem of the downloaded file; a UTC timestamp and `.log` are appended. */
  downloadName?: string
  emptyText?: string
  testId?: string
}

export function LogConsole(props: LogConsoleProps): ReactElement {
  const {
    log,
    title = 'Log',
    subtitle,
    downloadName = 'session',
    emptyText = 'Nothing yet.',
    testId = 'log'
  } = props
  const box = useRef<HTMLPreElement>(null)
  const pinned = useRef(true)

  // Follow new lines, unless the reader has scrolled up to look at something.
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [log.lines])

  const text = (): string => `${log.lines.join('\n')}\n`

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${downloadName}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const empty = log.lines.length === 0

  return (
    <Panel title={title} subtitle={subtitle}>
      <pre
        ref={box}
        style={preStyle}
        data-testid={testId}
        onScroll={(event) => {
          const el = event.currentTarget
          // A 24px tolerance, so a wheel that lands a pixel short of the
          // bottom does not silently stop the log following.
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {empty ? <span style={{ color: 'var(--text-dim, #999999)' }}>{emptyText}</span> : log.lines.join('\n')}
      </pre>
      {/* Under the log rather than in the panel header: three buttons do not
          fit beside a title in a narrow column, and they wrap into a stack. */}
      <div style={{ display: 'flex', gap: 'var(--space-2, 8px)', marginTop: 'var(--space-2, 8px)', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={buttonStyle('secondary')}
          onClick={() => void navigator.clipboard?.writeText(text())}
          disabled={empty}
        >
          Copy
        </button>
        <button type="button" style={buttonStyle('secondary')} onClick={download} disabled={empty}>
          Download .log
        </button>
        <button type="button" style={buttonStyle('secondary')} onClick={log.clear} disabled={empty}>
          Clear
        </button>
      </div>
    </Panel>
  )
}
