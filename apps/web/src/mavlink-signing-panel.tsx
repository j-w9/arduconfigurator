import { useEffect, useRef, useState } from 'react'

import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

// MAVLink v2 message-signing control. Lives in the Ports/Config surface,
// mirroring Mission Planner's "Setup > Advanced > MAVLink Signing".
//
// Two key-entry paths, matching real GCS behaviour:
//   - Passphrase: hashed to the 32-byte key via SHA-256 (Mission Planner /
//     QGC convention; the runtime owns the derivation so GCS + FC end up
//     with the identical key).
//   - Raw hex: paste a pre-shared 64-hex-char (32-byte) key directly.
//
// Security: the passphrase + key live only in this component's local React
// state and the codec. They are never persisted and never logged. Enabling
// signing applies the key to the codec (sign outbound + verify inbound).
// "Send to vehicle" provisions the FC with the same key via SETUP_SIGNING
// (msgid 256) — only offered while connected, since the spec requires a
// trusted/direct link.

interface MavlinkSigningPanelProps {
  runtime: ArduPilotConfiguratorRuntime
  /** True while a vehicle link is up — gates "Send to vehicle". */
  connected: boolean
}

type KeyMode = 'passphrase' | 'hex'

function parseHexKey(input: string): Uint8Array | undefined {
  const cleaned = input.trim().replace(/^0x/i, '').replace(/[\s:]/g, '')
  if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    return undefined
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function MavlinkSigningPanel(props: MavlinkSigningPanelProps) {
  const { runtime, connected } = props

  const [keyMode, setKeyMode] = useState<KeyMode>('passphrase')
  const [passphrase, setPassphrase] = useState('')
  const [hexKey, setHexKey] = useState('')
  const [linkId, setLinkId] = useState(0)
  const [enabled, setEnabled] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | undefined>(undefined)
  const [rejectionCount, setRejectionCount] = useState(0)
  const [sending, setSending] = useState(false)

  // The active 32-byte key is held in a ref (not React state) so it never
  // lands in a serialized snapshot, devtools prop tree, or re-render log.
  const activeKeyRef = useRef<Uint8Array | undefined>(undefined)

  const supported = runtime.supportsSigning()

  // Poll the codec's rejection count + surface live rejections. Polling (vs.
  // only the callback) keeps the displayed count correct even if the panel
  // mounts after rejections already occurred.
  useEffect(() => {
    if (!supported) {
      return
    }
    setRejectionCount(runtime.getSignatureRejectionCount())
    const unsubscribe = runtime.onSignatureRejection(() => {
      setRejectionCount(runtime.getSignatureRejectionCount())
    })
    const interval = window.setInterval(() => {
      setRejectionCount(runtime.getSignatureRejectionCount())
    }, 1000)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
    }
  }, [runtime, supported])

  const deriveKey = (): Uint8Array | undefined => {
    if (keyMode === 'passphrase') {
      if (passphrase.length === 0) {
        setFeedback({ tone: 'warning', text: 'Enter a passphrase first.' })
        return undefined
      }
      // The runtime derives + applies + returns the key; we keep it for a
      // later "send to vehicle" without re-deriving.
      return undefined
    }
    const parsed = parseHexKey(hexKey)
    if (!parsed) {
      setFeedback({ tone: 'danger', text: 'Hex key must be 64 hex characters (32 bytes).' })
      return undefined
    }
    return parsed
  }

  const handleApply = () => {
    try {
      if (keyMode === 'passphrase') {
        if (passphrase.length === 0) {
          setFeedback({ tone: 'warning', text: 'Enter a passphrase first.' })
          return
        }
        const key = runtime.configureSigningFromPassphrase(passphrase, { linkId, enabled: true })
        activeKeyRef.current = key
      } else {
        const key = deriveKey()
        if (!key) {
          return
        }
        runtime.configureSigningFromKey(key, { linkId, enabled: true })
        activeKeyRef.current = key
      }
      setEnabled(true)
      setFeedback({ tone: 'success', text: 'Signing enabled — outbound frames are signed and inbound signed frames verified.' })
    } catch (error) {
      setFeedback({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to apply signing key.' })
    }
  }

  const handleDisable = () => {
    runtime.disableSigning()
    activeKeyRef.current = undefined
    setEnabled(false)
    setFeedback({ tone: 'warning', text: 'Signing disabled. Frames are no longer signed or verified.' })
  }

  const handleSendToVehicle = async () => {
    const key = activeKeyRef.current
    if (!key) {
      setFeedback({ tone: 'warning', text: 'Apply a key first, then send it to the vehicle.' })
      return
    }
    setSending(true)
    try {
      await runtime.sendSigningSetup(key)
      setFeedback({ tone: 'success', text: 'Sent SETUP_SIGNING to the vehicle. The FC now shares this key.' })
    } catch (error) {
      setFeedback({ tone: 'danger', text: error instanceof Error ? error.message : 'Failed to send SETUP_SIGNING.' })
    } finally {
      setSending(false)
    }
  }

  if (!supported) {
    return null
  }

  return (
    <div data-testid="mavlink-signing-panel" style={{ marginTop: 24 }}>
      <Panel
        title="MAVLink signing"
        subtitle="Authenticate the link with a shared MAVLink v2 signing key. The key is derived from a passphrase (SHA-256) or pasted as a 32-byte hex key, kept in memory only, and never logged."
        actions={
          <StatusBadge tone={enabled ? 'success' : 'neutral'}>
            <span data-testid="signing-status">{enabled ? 'Signing on' : 'Signing off'}</span>
          </StatusBadge>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
          <div role="radiogroup" aria-label="Key source" style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="signing-key-mode"
                data-testid="signing-mode-passphrase"
                checked={keyMode === 'passphrase'}
                onChange={() => setKeyMode('passphrase')}
              />
              <span>Passphrase</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="signing-key-mode"
                data-testid="signing-mode-hex"
                checked={keyMode === 'hex'}
                onChange={() => setKeyMode('hex')}
              />
              <span>Hex key (32 bytes)</span>
            </label>
          </div>

          {keyMode === 'passphrase' ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Passphrase</span>
              <input
                type="password"
                data-testid="signing-passphrase-input"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="Shared passphrase (hashed to a 32-byte key)"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Hex key</span>
              <input
                type="text"
                data-testid="signing-hex-input"
                value={hexKey}
                onChange={(event) => setHexKey(event.target.value)}
                placeholder="64 hex characters (e.g. a1b2c3…)"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 160 }}>
            <span>Link ID</span>
            <input
              type="number"
              min={0}
              max={255}
              data-testid="signing-link-id-input"
              value={linkId}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10)
                setLinkId(Number.isFinite(next) ? Math.min(255, Math.max(0, next)) : 0)
              }}
            />
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={buttonStyle('primary')} data-testid="signing-apply-button" onClick={handleApply}>
              {enabled ? 'Update key' : 'Enable signing'}
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="signing-disable-button"
              onClick={handleDisable}
              disabled={!enabled}
            >
              Disable signing
            </button>
            <button
              type="button"
              style={buttonStyle()}
              data-testid="signing-send-to-vehicle-button"
              onClick={() => void handleSendToVehicle()}
              disabled={!connected || sending || !enabled}
              title={connected ? 'Provision the FC with this key (SETUP_SIGNING)' : 'Connect a vehicle to provision its key'}
            >
              {sending ? 'Sending…' : 'Send key to vehicle'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted, #b3b3b3)' }}>Rejected signed frames</span>
            <StatusBadge tone={rejectionCount > 0 ? 'warning' : 'neutral'}>
              <span data-testid="signing-rejection-count">{rejectionCount}</span>
            </StatusBadge>
          </div>

          {feedback ? (
            <p
              data-testid="signing-feedback"
              style={{
                margin: 0,
                fontSize: 13,
                color:
                  feedback.tone === 'success'
                    ? 'var(--success, #7fb966)'
                    : feedback.tone === 'danger'
                      ? 'var(--danger, #e2123f)'
                      : 'var(--warning, #ff6600)'
              }}
            >
              {feedback.text}
            </p>
          ) : null}

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim, #999999)' }}>
            The flight controller must hold the same key. Use "Send key to vehicle" over a trusted link (USB / wired) to
            provision it via SETUP_SIGNING, or set a matching passphrase on the FC from another GCS.
          </p>
        </div>
      </Panel>
    </div>
  )
}
