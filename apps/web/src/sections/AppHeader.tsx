// The app-shell header, extracted from App.tsx as part of its decomposition.
// A dumb presentational component (the established sections/ pattern): it
// imports no runtime / transport / MAVLink modules — App computes the header
// view model (battery/sensor/sync derivations, connection state) and passes
// plain props + semantic callbacks. Behavior-neutral lift of the original
// inline JSX: same markup, same data-testids, same class names, same copy.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { AppHeaderLogo } from '../app-header-logo'
import { APP_VERSION, GIT_BRANCH, GIT_HASH } from '../build-info'
import { connectButtonLabel } from '../connection-helpers'
import { batteryHealthTone } from '../device-display'
import type { ParameterFollowUp } from '../hooks/use-parameter-feedback'
import type { ProductMode } from '../hooks/use-product-mode'
import {
  DEFAULT_WEBSOCKET_URL,
  DEFAULT_UDP_TARGET,
  DEFAULT_TCP_TARGET,
  type TransportMode
} from '../hooks/use-transport-selection'

export interface HeaderSensorItem {
  id: string
  label: string
  stateClass: string
  title: string
}

export interface AppHeaderProps {
  snapshot: ConfiguratorSnapshot
  transportMode: TransportMode
  busyAction: string | undefined
  websocketUrl: string
  webSerialSupported: boolean
  udpSupported: boolean
  tcpSupported: boolean
  udpTarget: string
  tcpTarget: string
  onUdpTargetChange: (target: string) => void
  onTcpTargetChange: (target: string) => void
  headerBatteryPercent: number
  headerBatteryLabel: string
  headerWarningActive: boolean
  headerSensorItems: readonly HeaderSensorItem[]
  headerParameterLabel: string
  headerParameterPercent: number
  productMode: ProductMode
  parameterFollowUp: ParameterFollowUp | undefined
  onGoToSetup: () => void
  onTransportModeChange: (mode: TransportMode) => void
  onWebsocketUrlChange: (url: string) => void
  onProductModeChange: (mode: ProductMode) => void
  onConnect: () => void
  onDisconnect: () => void
}

export function AppHeader({
  snapshot,
  transportMode,
  busyAction,
  websocketUrl,
  webSerialSupported,
  udpSupported,
  tcpSupported,
  udpTarget,
  tcpTarget,
  onUdpTargetChange,
  onTcpTargetChange,
  headerBatteryPercent,
  headerBatteryLabel,
  headerWarningActive,
  headerSensorItems,
  headerParameterLabel,
  headerParameterPercent,
  productMode,
  parameterFollowUp,
  onGoToSetup,
  onTransportModeChange,
  onWebsocketUrlChange,
  onProductModeChange,
  onConnect,
  onDisconnect
}: AppHeaderProps) {
  return (
    <header className="app-header" data-testid="app-header">
      <button
        type="button"
        className="app-header__brand"
        data-testid="header-home-button"
        aria-label="Go to Setup"
        title="Go to Setup"
        onClick={onGoToSetup}
      >
        <span className="app-header__mark" aria-hidden="true">
          <AppHeaderLogo />
        </span>
        <span className="app-header__brand-copy">
          <strong>ArduConfigurator</strong>
          <small className="app-header__build" data-testid="app-build-info">
            v{APP_VERSION}
            {snapshot.hardware.board?.firmwareVersion ? ` · FW ${snapshot.hardware.board.firmwareVersion}` : ''}
            {' · '}
            <span data-testid="app-git-info" className="app-header__build--muted">{GIT_BRANCH}@{GIT_HASH}</span>
          </small>
        </span>
      </button>

      <div className="app-header__connection" data-testid="header-session-strip">
        <select
          data-testid="transport-mode-select"
          aria-label="Connection transport"
          value={transportMode}
          onChange={(event) => onTransportModeChange(event.target.value as TransportMode)}
          disabled={busyAction !== undefined || snapshot.connection.kind === 'connected'}
        >
          <option value="demo">Demo (Copter)</option>
          <option value="demo-plane">Demo (Plane)</option>
          <option value="demo-rover">Demo (Rover)</option>
          <option value="demo-sub">Demo (Sub)</option>
          <option value="web-serial" disabled={!webSerialSupported}>
            Serial / USB{webSerialSupported ? '' : ' (n/a)'}
          </option>
          <option value="websocket">WebSocket</option>
          {udpSupported ? <option value="udp">UDP (direct)</option> : null}
          {tcpSupported ? <option value="tcp">TCP (direct)</option> : null}
        </select>
        {transportMode === 'websocket' ? (
          <input
            data-testid="websocket-url-input"
            className="app-header__connection-input"
            type="text"
            value={websocketUrl}
            onChange={(event) => onWebsocketUrlChange(event.target.value)}
            disabled={busyAction !== undefined || snapshot.connection.kind === 'connected'}
            spellCheck={false}
            placeholder={DEFAULT_WEBSOCKET_URL}
          />
        ) : null}
        {transportMode === 'udp' ? (
          <input
            data-testid="udp-target-input"
            className="app-header__connection-input"
            type="text"
            value={udpTarget}
            onChange={(event) => onUdpTargetChange(event.target.value)}
            disabled={busyAction !== undefined || snapshot.connection.kind === 'connected'}
            spellCheck={false}
            placeholder={DEFAULT_UDP_TARGET}
          />
        ) : null}
        {transportMode === 'tcp' ? (
          <input
            data-testid="tcp-target-input"
            className="app-header__connection-input"
            type="text"
            value={tcpTarget}
            onChange={(event) => onTcpTargetChange(event.target.value)}
            disabled={busyAction !== undefined || snapshot.connection.kind === 'connected'}
            spellCheck={false}
            placeholder={DEFAULT_TCP_TARGET}
          />
        ) : null}
      </div>

      {snapshot.connection.kind === 'connected' || snapshot.connection.kind === 'connecting' ? (
        <div className="app-header__telemetry">
          <div className="header-quad-status" style={{ ['--battery-level' as string]: `${headerBatteryPercent}%` }}>
            <div className="header-quad-status__battery" title={headerBatteryLabel}>
              <div className={`header-battery-icon${snapshot.liveVerification.batteryTelemetry.verified ? ' is-live' : ''}${batteryHealthTone(snapshot) === 'danger' ? ' is-danger' : batteryHealthTone(snapshot) === 'warning' ? ' is-warning' : ''}`}>
                <span className="header-battery-icon__level" />
              </div>
              <div className="header-quad-status__legend">
                <strong>{headerBatteryLabel}</strong>
                <small data-testid="session-vehicle-name">{snapshot.vehicle?.vehicle ?? 'No vehicle'}</small>
              </div>
            </div>

            <div className="header-quad-status__flags">
              <span
                className={`header-quad-flag header-quad-flag--armed${snapshot.vehicle?.armed ? ' is-active is-warning' : ''}`}
                title={snapshot.vehicle?.armed ? 'Armed' : 'Disarmed'}
              />
              <span
                className={`header-quad-flag header-quad-flag--failsafe${headerWarningActive ? ' is-active is-warning' : ''}`}
                title={headerWarningActive ? 'Warnings or pre-arm issues are present.' : 'No current warnings.'}
              />
              <span
                className={`header-quad-flag header-quad-flag--link${snapshot.connection.kind === 'connected' ? ' is-active' : ''}`}
                title={snapshot.connection.kind === 'connected' ? 'Vehicle link connected.' : 'Disconnected.'}
              />
            </div>
          </div>

          <div className="header-sensor-status" aria-label="Live status sensors">
            {headerSensorItems.map((item) => (
              <div key={item.id} className={`header-sensor-status__item ${item.stateClass}`.trim()} title={item.title}>
                <span className={`header-sensor-status__icon header-sensor-status__icon--${item.id}`} />
                <span className="header-sensor-status__label">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="header-sync-panel">
            <strong data-testid="session-parameter-summary">{headerParameterLabel}</strong>
            <progress className="header-sync-panel__progress" value={headerParameterPercent} max={100} aria-label="Parameter sync progress" />
          </div>
        </div>
      ) : (
        <div className="app-header__disconnected-pill" data-testid="header-disconnected-pill" title="No flight controller connected.">
          <span className="app-header__disconnected-dot" aria-hidden="true" />
          <span>Disconnected</span>
        </div>
      )}

      <div className="app-header__mode-switch">
        <label className="expert-mode-toggle">
          <input
            type="checkbox"
            data-testid="product-mode-expert"
            checked={productMode === 'expert'}
            onChange={(event) => onProductModeChange(event.target.checked ? 'expert' : 'basic')}
          />
          <span className="expert-mode-toggle__track" aria-hidden="true">
            <span className="expert-mode-toggle__thumb" />
          </span>
          <span className="expert-mode-toggle__label">Enable Expert Mode</span>
        </label>
        <button
          type="button"
          data-testid="product-mode-basic"
          className="visually-hidden"
          onClick={() => onProductModeChange('basic')}
        >
          Basic
        </button>
      </div>

      <div className="app-header__actions">
        <div className="app-header__primary-actions">
          <button
            data-testid="connect-button"
            className="session-strip__button session-strip__button--connect"
            onClick={onConnect}
            disabled={busyAction !== undefined || snapshot.connection.kind === 'connected'}
          >
            {connectButtonLabel(snapshot, parameterFollowUp, busyAction)}
          </button>
          {/* Disconnect button: only render when there's something to
              disconnect from OR a connect attempt is in flight (so the
              operator can cancel a hung Connect). Otherwise the button
              is dead weight in the header. */}
          {snapshot.connection.kind === 'connected' ||
          snapshot.connection.kind === 'connecting' ||
          busyAction === 'connect' ||
          busyAction === 'connect:auto-serial' ||
          busyAction === 'disconnect' ? (
            <button
              data-testid="disconnect-button"
              className="session-strip__button session-strip__button--disconnect"
              onClick={onDisconnect}
              disabled={busyAction === 'disconnect'}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
}
