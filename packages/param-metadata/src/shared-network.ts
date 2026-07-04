// Shared AP_Networking (NET_*) parameter family. ArduPilot exposes an identical
// networking tree across vehicles on Ethernet/PPP-capable boards, so the
// definitions are generated once here and spread into a vehicle bundle.
//
// Verified against ArduPilot source (libraries/AP_Networking):
//   - Core params + NET_OPTIONS bits: AP_Networking.cpp var_info + AP_Networking.h
//     enum class OPTION.
//   - IP/GW/MAC are per-octet sub-params (NET_IPADDR0..3, NET_MACADDR0..5), most-
//     significant octet first (AP_Networking_address.cpp / _macaddr.cpp).
//   - NET_NETMASK is a PREFIX LENGTH (0..32), not octets (AP_Networking.cpp).
//   - Per-port endpoints NET_P1..P4_* : AP_Networking_port.cpp (TYPE/PROTOCOL/IP/PORT),
//     4 ports (AP_NETWORKING_NUM_PORTS).
//   - PPP: bring up via SERIALn_PROTOCOL=48 + NET_ENABLE=1 (AP_SerialManager PPP=48).
// NET_ENABLE is present on every networking-capable build regardless of backend,
// so its presence in the synced param set is the "this FC does networking" sentinel.

import { arducopterSerialProtocolOptions } from './arducopter-enums.js'
import type { FirmwareMetadataBundle, ParameterDefinition, ParameterValueOption } from './types.js'

const CORE = 'network'
const ENDPOINTS = 'network-endpoints'
const PASSTHROUGH = 'network-passthrough'

// NET_OPTIONS @Bitmask (AP_Networking.cpp) / enum class OPTION (AP_Networking.h).
// Bitmask option values are the BIT INDICES.
const NET_OPTIONS_BITS: ParameterValueOption[] = [
  { value: 0, label: 'PPP Ethernet gateway', description: 'Bridge a PPP serial link onto the Ethernet LAN.' },
  { value: 1, label: 'CAN1 multicast endpoint', description: 'Mirror CAN1 traffic onto the network as UDP multicast (for DroneCAN-over-IP tools).' },
  { value: 2, label: 'CAN2 multicast endpoint', description: 'Mirror CAN2 traffic onto the network as UDP multicast.' },
  { value: 3, label: 'CAN1 multicast bridged', description: 'Also re-inject network multicast back onto CAN1.' },
  { value: 4, label: 'CAN2 multicast bridged', description: 'Also re-inject network multicast back onto CAN2.' },
  { value: 5, label: 'Disable PPP timeout' },
  { value: 6, label: 'Disable PPP echo limit' },
  { value: 7, label: 'Capture packets to file' }
]

// NET_Pn_TYPE @Values (NetworkPortType, AP_Networking.h).
const NET_PORT_TYPE_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'UDP client', description: 'Send to a destination IP:port (broadcast if 255.255.255.255).' },
  { value: 2, label: 'UDP server', description: 'Bind and receive on the local IP:port.' },
  { value: 3, label: 'TCP client', description: 'Connect out to a destination IP:port.' },
  { value: 4, label: 'TCP server', description: 'Listen for connections on the local IP:port.' }
]

/** Four per-octet params (base0..base3), most-significant octet first. */
function octetGroup(base: string, name: string, category: string, rebootRequired: boolean): Record<string, ParameterDefinition> {
  const defs: Record<string, ParameterDefinition> = {}
  for (let i = 0; i < 4; i += 1) {
    defs[`${base}${i}`] = {
      id: `${base}${i}`,
      label: `${name} · byte ${i + 1}`,
      // Byte 0's description doubles as the composite field's tooltip, so keep it
      // about the whole address (and free of long unbreakable param-name tokens
      // that spill a fixed-width tooltip box).
      description:
        i === 0
          ? `${name} — four octets (0–255 each), most-significant first.`
          : `Byte ${i + 1} of 4 of ${name.toLowerCase()} (0–255).`,
      category,
      minimum: 0,
      maximum: 255,
      step: 1,
      ...(rebootRequired ? { rebootRequired: true } : {})
    }
  }
  return defs
}

/** The repeating per-port network endpoint family NET_Pn_* (n = 1..maxPort). */
export function buildNetworkPortParameterDefinitions(maxPort: number): FirmwareMetadataBundle['parameters'] {
  const defs: Record<string, ParameterDefinition> = {}
  for (let n = 1; n <= maxPort; n += 1) {
    const p = `NET_P${n}_`
    const active = { paramId: `${p}TYPE`, in: [1, 2, 3, 4] }
    defs[`${p}TYPE`] = {
      id: `${p}TYPE`,
      label: `Endpoint ${n} type`,
      description: `Network serial port ${n}. Client types need a destination IP; server types bind locally.`,
      category: ENDPOINTS,
      rebootRequired: true,
      options: NET_PORT_TYPE_OPTIONS
    }
    defs[`${p}PROTOCOL`] = {
      id: `${p}PROTOCOL`,
      label: `Endpoint ${n} protocol`,
      description: `Protocol carried over network port ${n} (same list as a SERIALn_PROTOCOL).`,
      category: ENDPOINTS,
      rebootRequired: true,
      visibleWhen: active,
      options: arducopterSerialProtocolOptions()
    }
    for (let i = 0; i < 4; i += 1) {
      defs[`${p}IP${i}`] = {
        id: `${p}IP${i}`,
        label: `Endpoint ${n} IP · byte ${i + 1}`,
        description: `Endpoint ${n}'s IP address. Only needed for CLIENT types (the destination to connect/send to). Leave it 0.0.0.0 for server types — the server binds all interfaces and any client may connect.`,
        category: ENDPOINTS,
        minimum: 0,
        maximum: 255,
        step: 1,
        visibleWhen: active
      }
    }
    defs[`${p}PORT`] = {
      id: `${p}PORT`,
      label: `Endpoint ${n} port`,
      description: `TCP/UDP port number for network port ${n}.`,
      category: ENDPOINTS,
      minimum: 0,
      maximum: 65535,
      step: 1,
      visibleWhen: active
    }
  }
  return defs
}

/**
 * AP_Periph serial↔network passthrough family NET_PASSn_* (n = 1..maxBlocks) —
 * bridges two serial-manager endpoints (a node UART ↔ a network endpoint). This
 * is a peripheral-firmware feature, so it appears only on DroneNet/AP_Periph
 * nodes; the DroneNet section reads it over DroneCAN.
 */
export function buildNetworkPassthroughParameterDefinitions(maxBlocks: number): FirmwareMetadataBundle['parameters'] {
  const defs: Record<string, ParameterDefinition> = {}
  const endpointDescription =
    'Serial-manager endpoint ID: 0–9 = a hardware UART/USB, 21–29 = network port 1–9 (TCP/UDP), 41–59 = a CAN serial-tunnel port.'
  for (let n = 1; n <= maxBlocks; n += 1) {
    const p = `NET_PASS${n}_`
    const active = { paramId: `${p}ENABLE`, in: [1] }
    defs[`${p}ENABLE`] = {
      id: `${p}ENABLE`,
      label: `Passthrough ${n}`,
      description: `Bridge two endpoints, pumping bytes both ways (e.g. expose a node UART as a TCP socket on the LAN).`,
      category: PASSTHROUGH,
      rebootRequired: true,
      options: [
        { value: 0, label: 'Disabled' },
        { value: 1, label: 'Enabled' }
      ]
    }
    defs[`${p}EP1`] = {
      id: `${p}EP1`,
      label: `Passthrough ${n} · endpoint 1`,
      description: endpointDescription,
      category: PASSTHROUGH,
      minimum: 0,
      maximum: 59,
      step: 1,
      visibleWhen: active
    }
    defs[`${p}EP2`] = {
      id: `${p}EP2`,
      label: `Passthrough ${n} · endpoint 2`,
      description: endpointDescription,
      category: PASSTHROUGH,
      minimum: 0,
      maximum: 59,
      step: 1,
      visibleWhen: active
    }
    defs[`${p}BAUD1`] = {
      id: `${p}BAUD1`,
      label: `Passthrough ${n} · endpoint 1 baud`,
      description: 'Baud rate for endpoint 1 (only meaningful when it is a hardware UART).',
      category: PASSTHROUGH,
      minimum: 0,
      maximum: 12500000,
      step: 1,
      visibleWhen: active
    }
    defs[`${p}BAUD2`] = {
      id: `${p}BAUD2`,
      label: `Passthrough ${n} · endpoint 2 baud`,
      description: 'Baud rate for endpoint 2 (only meaningful when it is a hardware UART).',
      category: PASSTHROUGH,
      minimum: 0,
      maximum: 12500000,
      step: 1,
      visibleWhen: active
    }
    defs[`${p}OPT1`] = {
      id: `${p}OPT1`,
      label: `Passthrough ${n} · endpoint 1 options`,
      description: 'Serial options bitmask for endpoint 1 (only meaningful when it is a hardware UART).',
      category: PASSTHROUGH,
      minimum: 0,
      step: 1,
      visibleWhen: active
    }
    defs[`${p}OPT2`] = {
      id: `${p}OPT2`,
      label: `Passthrough ${n} · endpoint 2 options`,
      description: 'Serial options bitmask for endpoint 2 (only meaningful when it is a hardware UART).',
      category: PASSTHROUGH,
      minimum: 0,
      step: 1,
      visibleWhen: active
    }
  }
  return defs
}

/** Core NET_* IP / PPP / options params + the per-port endpoint family. */
export function buildNetworkParameterDefinitions(): FirmwareMetadataBundle['parameters'] {
  return {
    NET_ENABLE: {
      id: 'NET_ENABLE',
      label: 'Networking',
      description: 'Enable the onboard IP networking stack (Ethernet or PPP). Presence of this parameter means the firmware supports networking.',
      category: CORE,
      rebootRequired: true,
      notes: ['Reboot after enabling. On boards without native Ethernet, networking runs over PPP — set a SERIALn_PROTOCOL to PPP (48) on the link that carries it.'],
      options: [
        { value: 0, label: 'Disabled' },
        { value: 1, label: 'Enabled' }
      ]
    },
    NET_DHCP: {
      id: 'NET_DHCP',
      label: 'DHCP client',
      description: 'Request an IP address automatically from a DHCP server on the LAN. Disable to use the static address below.',
      category: CORE,
      rebootRequired: true,
      options: [
        { value: 0, label: 'Disabled (static IP)' },
        { value: 1, label: 'Enabled' }
      ]
    },
    ...octetGroup('NET_IPADDR', 'Static IP address', CORE, true),
    NET_NETMASK: {
      id: 'NET_NETMASK',
      label: 'Subnet mask (prefix length)',
      description: 'Subnet size as a prefix length, NOT dotted-quad: 24 = 255.255.255.0, 16 = 255.255.0.0, 8 = 255.0.0.0.',
      category: CORE,
      rebootRequired: true,
      minimum: 0,
      maximum: 32,
      step: 1
    },
    ...octetGroup('NET_GWADDR', 'Gateway address', CORE, false),
    ...octetGroup('NET_REMPPP_IP', 'Remote PPP peer IP', CORE, false),
    NET_MACADDR0: macOctet(0),
    NET_MACADDR1: macOctet(1),
    NET_MACADDR2: macOctet(2),
    NET_MACADDR3: macOctet(3),
    NET_MACADDR4: macOctet(4),
    NET_MACADDR5: macOctet(5),
    NET_OPTIONS: {
      id: 'NET_OPTIONS',
      label: 'Networking options',
      description: 'Optional networking features (PPP gateway, CAN-over-UDP multicast bridge, packet capture).',
      category: CORE,
      rebootRequired: true,
      bitmask: true,
      options: NET_OPTIONS_BITS
    },
    // PPP link config (AP_Periph nodes that run networking over PPP).
    NET_PPP_PORT: {
      id: 'NET_PPP_PORT',
      label: 'PPP serial port',
      description: 'Serial-manager port index that carries the PPP link on this node.',
      category: CORE,
      rebootRequired: true,
      minimum: 0,
      maximum: 9,
      step: 1
    },
    NET_PPP_BAUD: {
      id: 'NET_PPP_BAUD',
      label: 'PPP baud rate',
      description: 'Baud rate of the PPP serial link (e.g. 12500000 for a 12.5 Mbaud CAN-adjacent link).',
      category: CORE,
      rebootRequired: true,
      minimum: 0,
      maximum: 12500000,
      step: 1
    },
    // Vehicles expose NET_P1..P4; AP_Periph up to NET_P1..P9. Generate the full
    // set — presence-gating hides the ones a given board doesn't report.
    ...buildNetworkPortParameterDefinitions(9),
    ...buildNetworkPassthroughParameterDefinitions(9)
  }
}

function macOctet(i: number): ParameterDefinition {
  return {
    id: `NET_MACADDR${i}`,
    label: `MAC address · byte ${i + 1}`,
    // Byte 0's description doubles as the composite MAC field's tooltip.
    description:
      i === 0
        ? 'Interface MAC address — six octets (0–255 each). Leave default unless your network requires a specific MAC.'
        : `Byte ${i + 1} of 6 of the interface MAC address (0–255).`,
    category: CORE,
    rebootRequired: true,
    minimum: 0,
    maximum: 255,
    step: 1
  }
}
