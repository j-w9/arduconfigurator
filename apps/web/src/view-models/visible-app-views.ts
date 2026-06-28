// Visible top-level nav views for the app switcher.
//
// Part of the App.tsx view-model decomposition. Once buildAppViews produces
// the metadata-derived view descriptors, App.tsx filtered them by Expert
// mode, appended the five descriptors that are not metadata-driven (RC Mixer,
// CAN, Flash, Files, Calibration — each with a live/connection-aware badge),
// relabelled Setup as "Status & Info", and sorted everything into the
// canonical tab order. It is a pure derivation over the view list, the Expert
// flag, and the CAN-bus / connection status, so it is lifted verbatim into
// buildVisibleAppViews. App.tsx passes those inputs in and keeps the same memo
// dependencies. Behavior-preserving — these descriptors are plain nav data.

import { isExpertOnlyView } from '../guided-setup-shortcut'
import type { AppViewDescriptor } from '../app-types'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export interface VisibleAppViewsInputs {
  appViews: AppViewDescriptor[]
  isExpertMode: boolean
  canBusStatus: ConfiguratorSnapshot['canBus']['status']
  canBusBus: ConfiguratorSnapshot['canBus']['bus']
  connectionKind: ConfiguratorSnapshot['connection']['kind']
}

export function buildVisibleAppViews(inputs: VisibleAppViewsInputs): AppViewDescriptor[] {
  const { appViews, isExpertMode, canBusStatus, canBusBus, connectionKind } = inputs

  const base = appViews.filter((view) => isExpertMode || !isExpertOnlyView(view.id))
  // RC Mixer was originally hidden behind ?rcMixer=1 because ArduPilot
  // doesn't yet expose multi-function-per-channel with PWM ranges. It
  // graduated to the main nav once the view's persistent
  // "Not available in ArduPilot" callout proved load-bearing enough
  // to keep operators honest about the scaffold-only nature.
  const rcMixerDescriptor: AppViewDescriptor = {
    id: 'rc-mixer',
    label: 'RC Mixer',
    description: 'BF-style RC option mixer — multiple functions per channel with PWM activation ranges. Preview only; not yet wired to ArduPilot.',
    badge: 'preview',
    tone: 'warning'
  }
  // DroneCAN inspector. Mirrors Mission Planner's workflow over the
  // MAVLink CAN_FORWARD tunnel so MAVLink stays alive on the same
  // channel during inspection. Badge reflects live session status.
  const canBusBadge =
    canBusStatus === 'active'
      ? `CAN${canBusBus} live`
      : canBusStatus === 'requesting'
        ? 'connecting'
        : canBusStatus === 'stopping'
          ? 'stopping'
          : canBusStatus === 'error'
            ? 'error'
            : 'idle'
  const canBusDescriptor: AppViewDescriptor = {
    id: 'can',
    label: 'CAN',
    description: 'DroneCAN bus inspector — discover nodes, read identity, edit and save per-node parameters via the MAVLink CAN_FORWARD tunnel.',
    badge: canBusBadge,
    tone: canBusStatus === 'active' ? 'success' : canBusStatus === 'error' ? 'danger' : 'neutral'
  }
  // Dedicated Flash tab — promoted from the modal-only flow on the
  // landing screen + header so DFU entry, custom-build-server config,
  // and the flash wizard live in one persistent surface. Always visible
  // since flashing is bench / cold-start work that must work without
  // an authenticated session.
  const flashDescriptor: AppViewDescriptor = {
    id: 'flash',
    label: 'Flash',
    description: 'Firmware flasher — pick an ArduPilot release or point at a custom build server, enter DFU bootloader, or drop a .apj for guided flashing.',
    badge: 'tools',
    tone: 'neutral'
  }
  // MAVFTP file browser. Only meaningful with a live link, but kept
  // visible (disabled-state copy inside) so the surface is discoverable.
  const filesDescriptor: AppViewDescriptor = {
    id: 'files',
    label: 'Files',
    description: 'Browse the flight controller filesystem over MAVLink FTP — download, upload, and delete files (@SYS status, /APM SD-card files, Lua scripts).',
    badge: connectionKind === 'connected' ? 'live' : 'idle',
    tone: 'neutral'
  }
  // Dedicated Calibration surface — the accelerometer / level / compass
  // guided-action flow gathered into one tab (same actions as Setup).
  const calibrationDescriptor: AppViewDescriptor = {
    id: 'calibration',
    label: 'Calibration',
    description: 'Sensor calibration — accelerometer (6-pose), level, and compass. Same guided flow as Setup, in one place.',
    badge: connectionKind === 'connected' ? 'ready' : 'idle',
    tone: 'neutral'
  }
  // Read-only live-traffic inspectors — expert-only advanced tools, injected
  // at render time and only when Expert mode is on.
  const mavlinkInspectorDescriptor: AppViewDescriptor = {
    id: 'mavlink-inspector',
    label: 'MAVLink Inspector',
    description: 'Live decoded MAVLink message stream — per-type rate, count, and last value. Read-only.',
    badge: connectionKind === 'connected' ? 'live' : 'idle',
    tone: 'neutral'
  }
  const dronecanInspectorDescriptor: AppViewDescriptor = {
    id: 'dronecan-inspector',
    label: 'DroneCAN Inspector',
    description: 'Live DroneCAN bus traffic over the CAN_FORWARD tunnel — messages by node, rate, and last value. Read-only.',
    badge: canBusStatus === 'active' ? `CAN${canBusBus} live` : 'idle',
    tone: canBusStatus === 'active' ? 'success' : 'neutral'
  }
  // Canonical tab order (single source of truth). The Setup tab is the
  // health/status/info dashboard, so it leads and is relabelled; the rest
  // follow a setup -> tuning -> tools flow. Views not listed fall to the
  // end in their original order.
  const CANONICAL_VIEW_ORDER = [
    'setup', 'calibration', 'config', 'ports', 'receiver', 'modes', 'motors',
    'servos', 'power', 'failsafe', 'vtx', 'osd', 'tuning', 'presets',
    'snapshots', 'logs', 'parameters', 'can', 'files', 'flash', 'rc-mixer',
    'mavlink-inspector', 'dronecan-inspector'
  ]
  const relabelled = base.map((view) =>
    view.id === 'setup'
      ? { ...view, label: 'Status & Info', description: 'Vehicle health, live status, system info, and guided setup.' }
      : view
  )
  const combined = [
    ...relabelled,
    calibrationDescriptor,
    rcMixerDescriptor,
    canBusDescriptor,
    flashDescriptor,
    filesDescriptor,
    // Expert-only inspectors — only surfaced when Expert mode is on.
    ...(isExpertMode ? [mavlinkInspectorDescriptor, dronecanInspectorDescriptor] : [])
  ]
  const rankOf = (id: string): number => {
    const index = CANONICAL_VIEW_ORDER.indexOf(id)
    return index === -1 ? CANONICAL_VIEW_ORDER.length : index
  }
  return [...combined].sort((left, right) => rankOf(left.id) - rankOf(right.id))
}
