import type { CSSProperties, PropsWithChildren, ReactElement, ReactNode } from 'react'

import { buttonStyle } from './index.js'

// The connect strip: what state the link is in, and the buttons that change
// it. Lifted out of ArduConfigurator's AppHeader so a second product does not
// re-draw it — the browser's own port dialog stays the port list (it is the
// only thing that can grant permission; a page-rendered list can never show
// more than what was already granted), and this is the affordance that opens
// it.
//
// Presentational only: it holds no connection, opens no port, and decides
// nothing. The caller owns the transport and passes state plus callbacks.
//
// Styled inline over the theme tokens, the way Panel/StatusBadge/buttonStyle
// are, rather than by moving app stylesheet rules — apps/web's pill shares one
// consolidated "one chip" rule with four unrelated components, and splitting
// that to relocate a single selector would undo a deliberate consolidation.

const palette = {
  surface: 'var(--surface-300, #2b2b2b)',
  border: 'var(--border-soft, #333333)',
  text: 'var(--text, #f2f2f2)',
  muted: 'var(--text-muted, #b3b3b3)',
  idle: 'var(--surface-700, #808080)',
  success: 'var(--success, #7fb966)',
  warning: 'var(--warning, #ff6600)'
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

const DOT_TONE: Record<ConnectionState, string> = {
  disconnected: palette.idle,
  connecting: palette.warning,
  connected: palette.success
}

const DEFAULT_LABEL: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected'
}

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2, 8px)',
  flex: '0 0 auto',
  minHeight: 24,
  padding: '4px 10px',
  borderRadius: 999,
  border: `1px solid ${palette.border}`,
  background: palette.surface,
  color: palette.muted,
  fontFamily: 'var(--font-ui, system-ui, sans-serif)',
  fontSize: 'var(--text-md, 0.875rem)',
  whiteSpace: 'nowrap'
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3, 12px)',
  flexWrap: 'wrap',
  color: palette.text
}

export interface ConnectionStatusPillProps {
  state: ConnectionState
  /** Overrides the default wording for the state. */
  label?: string
  title?: string
  testId?: string
}

/** The state chip: a toned dot and a word. */
export function ConnectionStatusPill(props: ConnectionStatusPillProps): ReactElement {
  const { state, label, title, testId } = props
  return (
    <div style={pillStyle} data-testid={testId} data-state={state} title={title}>
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: DOT_TONE[state],
          boxShadow: 'inset 0 0 0 1px rgba(var(--edge-rgb, 255, 255, 255), 0.08)'
        }}
      />
      <span>{label ?? DEFAULT_LABEL[state]}</span>
    </div>
  )
}

export interface ConnectionBarProps {
  state: ConnectionState
  /**
   * An action is in flight. Every button is disabled while set, so a second
   * click cannot start a second connect over the first.
   */
  busy?: boolean
  onConnect: () => void
  onDisconnect?: () => void
  /**
   * Opens the browser's own port dialog. Omit where the transport has no port
   * to choose (a socket, a demo) and the button is not rendered.
   */
  onChoosePort?: () => void
  connectLabel?: string
  choosePortLabel?: string
  statusLabel?: string
  testIdPrefix?: string
}

/**
 * The bar as a whole. `children` sits between the status and the buttons —
 * where ArduConfigurator puts its expert-mode switch and theme toggle, and
 * where another product puts whatever it keeps in its header.
 *
 * Disconnect renders only when there is something to disconnect from, or a
 * connect is in flight so a hung attempt can be cancelled. "Choose a different
 * port" renders only while not connected: switching ports under a live link is
 * not a thing the browser will do.
 */
export function ConnectionBar(props: PropsWithChildren<ConnectionBarProps>): ReactElement {
  const {
    state,
    busy = false,
    onConnect,
    onDisconnect,
    onChoosePort,
    connectLabel = 'Connect',
    choosePortLabel = 'Choose a different port',
    statusLabel,
    testIdPrefix = '',
    children
  } = props

  const live = state === 'connected'
  const settling = state === 'connecting'
  const testId = (name: string): string => `${testIdPrefix}${name}`
  const actions: ReactNode[] = []

  actions.push(
    <button
      key="connect"
      type="button"
      data-testid={testId('connect-button')}
      style={buttonStyle('primary')}
      onClick={onConnect}
      disabled={busy || live}
    >
      {connectLabel}
    </button>
  )

  if (onChoosePort && !live && !settling) {
    actions.push(
      <button
        key="choose-port"
        type="button"
        data-testid={testId('choose-serial-port-button')}
        style={buttonStyle('secondary')}
        onClick={onChoosePort}
        disabled={busy}
        title="Open the browser's serial-port picker to grant or switch to a different port."
      >
        {choosePortLabel}
      </button>
    )
  }

  if (onDisconnect && (live || settling || busy)) {
    actions.push(
      <button
        key="disconnect"
        type="button"
        data-testid={testId('disconnect-button')}
        style={buttonStyle('secondary')}
        onClick={onDisconnect}
        disabled={busy && !live && !settling}
      >
        Disconnect
      </button>
    )
  }

  return (
    <div style={barStyle} data-testid={testId('connection-bar')}>
      <ConnectionStatusPill
        state={state}
        label={statusLabel}
        testId={testId('connection-status-pill')}
      />
      {children}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)', marginLeft: 'auto' }}>
        {actions}
      </div>
    </div>
  )
}
