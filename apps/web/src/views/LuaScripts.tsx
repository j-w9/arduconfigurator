import { useRef } from 'react'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { LuaScriptCard, ScriptingCapabilityResult } from '../view-models/lua-scripts'
import { InfoDot } from './InfoDot'

// Presentational Lua Scripts tab. App owns all state (installed listing,
// busy/error) and handlers; this view only renders and dispatches callbacks.
// No runtime / transport / MAVLink imports, per the "Adding a View" pattern.
//
// Design note: this tab stays deliberately calm. Colour and any filled/boxed
// treatment are reserved for genuinely actionable or warning states (the
// "enable scripting" prompt, the "no scripting engine" banner, a low heap, an
// unmet prerequisite). Everything informational is plain muted text, and each
// applet's long description + full prerequisite list live one hover/click away
// inside an InfoDot rather than always on screen.

export interface InstalledLuaScript {
  name: string
  sizeBytes?: number
}

export interface LuaScriptsViewProps {
  connected: boolean
  capability: ScriptingCapabilityResult
  /** Where scripts live on this vehicle (/APM/scripts on hardware). */
  scriptsDir: string
  cards: readonly LuaScriptCard[]
  /** Installed .lua files, or undefined before the first listing completes. */
  installed: readonly InstalledLuaScript[] | undefined
  installedLoading: boolean
  installedError?: string
  /** Result of the last action (install / upload / remove / enable / reboot). */
  notice?: { tone: 'success' | 'danger'; text: string }
  /** Current busy action key, e.g. 'lua:enable', `lua:install:${id}`. */
  busyAction?: string
  onEnableScripting: () => void
  onReboot: () => void
  /** Restart Lua scripting without rebooting the flight controller. */
  onRestartScripting: () => void
  /** Stop Lua scripting until the next restart/reboot. */
  onStopScripting: () => void
  onRefresh: () => void
  onInstall: (appletId: string) => void
  onRemove: (name: string) => void
  onUpload: (file: File) => void
}

function formatSize(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return '—'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  return `${(sizeBytes / 1024).toFixed(1)} KiB`
}

function kib(bytes: number | null): number {
  return Math.round(((bytes ?? 0) / 1024) * 10) / 10
}

function CapabilityBanner(props: {
  capability: ScriptingCapabilityResult
  busyAction?: string
  onEnableScripting: () => void
  onReboot: () => void
  onRestartScripting: () => void
  onStopScripting: () => void
}) {
  const { capability, busyAction, onEnableScripting, onReboot, onRestartScripting, onStopScripting } = props
  const enabling = busyAction === 'lua:enable'
  const rebooting = busyAction === 'lua:reboot'
  const restartingScripting = busyAction === 'lua:restart-scripting'
  const stoppingScripting = busyAction === 'lua:stop-scripting'

  // A genuine warning: this build has no Lua VM at all.
  if (capability.capability === 'unsupported') {
    return (
      <div className="bf-note bf-note--warning" data-testid="lua-capability" data-capability="unsupported">
        <p>
          <strong>This firmware can’t run Lua.</strong> No <code>SCR_ENABLE</code> parameter was reported, so this
          board’s build was compiled without the scripting engine. Flash a build with scripting enabled (most
          2&nbsp;MB+ boards ship one) to install scripts.
        </p>
      </div>
    )
  }

  // Actionable: scripting is off — keep a boxed prompt with the enable/reboot controls.
  if (capability.capability === 'disabled') {
    return (
      <div className="bf-note bf-note--accent" data-testid="lua-capability" data-capability="disabled">
        <p>
          <strong>Scripting is switched off.</strong> This board can run Lua, but <code>SCR_ENABLE</code> is 0. Enable
          it (a sane heap is staged too if the current one is small), then <em>reboot</em> — scripts only start after a
          restart.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            type="button"
            style={buttonStyle('primary')}
            onClick={onEnableScripting}
            disabled={Boolean(busyAction)}
            data-testid="lua-enable"
          >
            {enabling ? 'Enabling…' : 'Enable scripting'}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            onClick={onReboot}
            disabled={Boolean(busyAction)}
            data-testid="lua-reboot"
          >
            {rebooting ? 'Rebooting…' : 'Reboot flight controller'}
          </button>
        </div>
      </div>
    )
  }

  // enabled — a slim single status line, not a filled box. A low heap is still a real warning below it.
  return (
    <div data-testid="lua-capability" data-capability="enabled">
      <p className="lua-status-line lua-status-line--success">
        <StatusBadge tone="success">Scripting on</StatusBadge>
        <span className="lua-status-text">
          Lua is enabled{capability.heapSizePresent ? ` · heap ${kib(capability.heapSizeBytes)} KiB` : ''}. Restart
          scripting to apply newly-installed scripts — a full reboot is not needed.
        </span>
        {/* Restart scripting is the action ArduPilot actually asks for when a
         *  script changes ("restart scripting" STATUSTEXT). It is listed first
         *  and styled as the primary because a reboot to achieve the same thing
         *  drops the link, re-runs every startup check and re-syncs the whole
         *  parameter table. */}
        <button
          type="button"
          className="lua-status-spacer"
          style={buttonStyle('primary')}
          onClick={onRestartScripting}
          disabled={Boolean(busyAction)}
          data-testid="lua-restart-scripting"
          title="Stop and restart onboard Lua scripting (MAV_CMD_SCRIPTING). The flight controller stays up."
        >
          {restartingScripting ? 'Restarting scripting…' : 'Restart scripting'}
        </button>
        <button
          type="button"
          style={buttonStyle()}
          onClick={onStopScripting}
          disabled={Boolean(busyAction)}
          data-testid="lua-stop-scripting"
          title="Stop onboard Lua scripting until the next restart or reboot."
        >
          {stoppingScripting ? 'Stopping…' : 'Stop scripting'}
        </button>
        <button
          type="button"
          style={buttonStyle()}
          onClick={onReboot}
          disabled={Boolean(busyAction)}
          data-testid="lua-reboot"
        >
          {rebooting ? 'Rebooting…' : 'Reboot'}
        </button>
      </p>
      {capability.heapLow ? (
        <p className="switch-exercise-warning" data-testid="lua-heap-warning" style={{ marginTop: 8 }}>
          Heap looks small ({kib(capability.heapSizeBytes)} KiB). If scripts fail to start with an out-of-memory error,
          raise <code>SCR_HEAP_SIZE</code> to at least {kib(capability.recommendedHeapBytes)} KiB and reboot.
        </p>
      ) : null}
    </div>
  )
}

function AppletCard(props: {
  card: LuaScriptCard
  busyAction?: string
  canInstall: boolean
  onInstall: (id: string) => void
}) {
  const { card, busyAction, canInstall, onInstall } = props
  const { meta, sanity, installed } = card
  const isBusy = Boolean(busyAction)

  return (
    <article className="lua-card" data-testid={`lua-card-${meta.id}`}>
      <div className="lua-card-head">
        <span className="lua-card-name">{meta.name}</span>
        <span className="lua-tag">{meta.category}</span>
        <InfoDot label={`About ${meta.name}`} wide testId={`lua-info-${meta.id}`}>
          <span className="lua-info-body">
            <span>{meta.description}</span>
            {meta.prerequisites.length > 0 ? (
              <span className="lua-info-prereqs">
                {meta.prerequisites.map((prereq) => {
                  const unmet = sanity.unmet.some((u) => u.label === prereq.label)
                  const marker = prereq.test.kind === 'info' ? '•' : unmet ? '⚠' : '✓'
                  return (
                    <span key={prereq.label} className={unmet ? 'is-unmet' : undefined}>
                      {marker} {prereq.label}
                      {prereq.detail ? <span className="lua-prereq-detail"> — {prereq.detail}</span> : null}
                    </span>
                  )
                })}
              </span>
            ) : null}
          </span>
        </InfoDot>
        <div className="lua-card-actions">
          <button
            type="button"
            style={buttonStyle(installed ? 'secondary' : 'primary')}
            onClick={() => onInstall(meta.id)}
            disabled={isBusy || !canInstall}
            data-testid={`lua-install-${meta.id}`}
          >
            {busyAction === `lua:install:${meta.id}` ? 'Installing…' : installed ? 'Reinstall' : 'Install'}
          </button>
          {installed ? <StatusBadge tone="success">Installed</StatusBadge> : null}
          <a
            className="lua-source-link"
            href={`https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_Scripting/applets/${meta.filename}`}
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </div>
      </div>

      <p className="lua-card-summary">{meta.summary}</p>

      {sanity.unmet.length > 0 ? (
        <details className="lua-prereq-warn" data-testid={`lua-prereq-${meta.id}`}>
          <summary>
            ⚠ {sanity.unmet.length} prerequisite{sanity.unmet.length === 1 ? '' : 's'} to check
          </summary>
          <ul>
            {sanity.unmet.map((u) => (
              <li key={u.label}>
                {u.label}
                {u.detail ? <span style={{ opacity: 0.75 }}> — {u.detail}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  )
}

export function LuaScriptsView(props: LuaScriptsViewProps) {
  const {
    connected,
    capability,
    scriptsDir,
    cards,
    installed,
    installedLoading,
    installedError,
    notice,
    busyAction,
    onEnableScripting,
    onReboot,
    onRestartScripting,
    onStopScripting,
    onRefresh,
    onInstall,
    onRemove,
    onUpload
  } = props

  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const isBusy = Boolean(busyAction)
  const canInstall = capability.capability !== 'unsupported'

  return (
    <div id="setup-panel-lua" data-testid="lua-view">
      <Panel
        title="Lua Scripts"
        subtitle="Install curated ArduPilot applets or upload your own Lua scripts to the flight controller’s SD card."
      >
        {!connected ? (
          <p className="lua-subtitle" data-testid="lua-disconnected">
            Connect to a vehicle to manage its Lua scripts.
          </p>
        ) : (
          <div className="lua-scripts">
            <CapabilityBanner
              capability={capability}
              busyAction={busyAction}
              onEnableScripting={onEnableScripting}
              onReboot={onReboot}
              onRestartScripting={onRestartScripting}
              onStopScripting={onStopScripting}
            />

            {notice ? (
              notice.tone === 'danger' ? (
                <p className="switch-exercise-warning" data-testid="lua-notice" data-tone="danger" style={{ marginTop: 12 }}>
                  {notice.text}
                </p>
              ) : (
                <p className="lua-status-line" data-testid="lua-notice" data-tone="success" style={{ marginTop: 12 }}>
                  <StatusBadge tone="success">Done</StatusBadge>
                  <span className="lua-status-text">{notice.text}</span>
                </p>
              )
            ) : null}

            {/* Installed scripts */}
            <section className="lua-section" data-testid="lua-installed-section">
              <div className="lua-section-head">
                <h3>
                  Installed scripts <code>{scriptsDir}</code>
                </h3>
                <button
                  type="button"
                  style={buttonStyle()}
                  onClick={onRefresh}
                  disabled={isBusy}
                  data-testid="lua-refresh"
                >
                  {installedLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              {installedError ? (
                <p className="switch-exercise-warning" data-testid="lua-installed-error">
                  {installedError}
                </p>
              ) : null}

              {installed === undefined && !installedLoading ? null : installed && installed.length === 0 ? (
                <p className="lua-subtitle" data-testid="lua-installed-empty">
                  No scripts installed yet. Install one below or upload your own.
                </p>
              ) : (
                <ul className="lua-installed-list" data-testid="lua-installed-list">
                  {(installed ?? []).map((script) => (
                    <li key={script.name} data-testid={`lua-installed-row-${script.name}`}>
                      <span>
                        <code>{script.name}</code>{' '}
                        <span className="lua-installed-size">{formatSize(script.sizeBytes)}</span>
                      </span>
                      <button
                        type="button"
                        style={buttonStyle()}
                        onClick={() => onRemove(script.name)}
                        disabled={isBusy}
                        data-testid={`lua-remove-${script.name}`}
                      >
                        {busyAction === `lua:remove:${script.name}` ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Upload your own */}
            <section className="lua-section" data-testid="lua-upload-section">
              <div className="lua-section-head">
                <h3>Upload your own</h3>
                <button
                  type="button"
                  style={buttonStyle('primary')}
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={isBusy || !canInstall}
                  data-testid="lua-upload"
                >
                  {busyAction === 'lua:upload' ? 'Uploading…' : 'Upload .lua'}
                </button>
              </div>
              <p className="lua-subtitle">
                Drop a <code>.lua</code> file onto the flight controller. It uploads to <code>{scriptsDir}</code>; a
                reboot starts it.
                {!canInstall ? ' Uploading is disabled because this firmware has no scripting engine.' : ''}
              </p>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".lua"
                hidden
                data-testid="lua-upload-input"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onUpload(file)
                  event.target.value = ''
                }}
              />
            </section>

            {/* Curated catalog */}
            <section className="lua-section" data-testid="lua-catalog">
              <div className="lua-section-head">
                <h3>
                  Common scripts
                  <InfoDot label="About the curated catalog" wide testId="lua-catalog-info" wikiTopic="luaInstallingScripts">
                    Curated single-file ArduPilot applets (GPL-3.0), each bundled in the app so install is one click —
                    no network fetch. The “prerequisites” on a card are best-effort warnings, never blockers.
                  </InfoDot>
                </h3>
              </div>
              <div className="lua-card-grid">
                {cards.map((card) => (
                  <AppletCard
                    key={card.meta.id}
                    card={card}
                    busyAction={busyAction}
                    canInstall={canInstall}
                    onInstall={onInstall}
                  />
                ))}
              </div>
            </section>

            <p className="lua-footnotes">
              Scripts run from {scriptsDir} on hardware (SITL uses /scripts); a reboot starts newly-added scripts.
              Bundled applets are GPL-3.0 from ArduPilot’s AP_Scripting/applets, redistributed unmodified.
            </p>
          </div>
        )}
      </Panel>
    </div>
  )
}
