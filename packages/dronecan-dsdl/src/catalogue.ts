// The DroneCAN type catalogue: every DSDL type this build knows, looked up by
// full name or by default data type id, with its signature and a codec.

import { decodeDronecanSection, encodeDronecanSection, DronecanCodecError } from './codec.js'
import { DRONECAN_CATALOGUE_DATA } from './generated/catalogue.js'
import type {
  DronecanCatalogueData,
  DronecanSectionDesc,
  DronecanSectionKind,
  DronecanTypeEntry,
  DronecanValue
} from './types.js'

export interface DronecanTypeInfo {
  fullName: string
  /** Last dotted part, for compact labels: "NodeStatus". */
  shortName: string
  kind: 'message' | 'service'
  dataTypeId: number | null
  signature: bigint
}

export class DronecanCatalogue {
  private readonly messagesById = new Map<number, string>()
  private readonly servicesById = new Map<number, string>()

  constructor(private readonly data: DronecanCatalogueData = DRONECAN_CATALOGUE_DATA) {
    for (const [fullName, entry] of Object.entries(data.types)) {
      if (entry.id === null) continue
      ;(entry.k === 'm' ? this.messagesById : this.servicesById).set(entry.id, fullName)
    }
  }

  /** The DSDL commit the catalogue was generated from. */
  get dsdlCommit(): string {
    return this.data.dsdlCommit
  }

  has(fullName: string): boolean {
    return fullName in this.data.types
  }

  info(fullName: string): DronecanTypeInfo | undefined {
    const entry = this.data.types[fullName]
    return entry ? toInfo(fullName, entry) : undefined
  }

  /** Every type, sorted by full name. */
  list(): DronecanTypeInfo[] {
    return Object.keys(this.data.types)
      .sort()
      .map((fullName) => toInfo(fullName, this.data.types[fullName]))
  }

  /** The broadcast message with this default data type id. */
  messageById(dataTypeId: number): DronecanTypeInfo | undefined {
    const name = this.messagesById.get(dataTypeId)
    return name ? this.info(name) : undefined
  }

  /** The service with this default data type id. */
  serviceById(dataTypeId: number): DronecanTypeInfo | undefined {
    const name = this.servicesById.get(dataTypeId)
    return name ? this.info(name) : undefined
  }

  /** A section of a type: 'msg' for messages, 'req' / 'res' for services. */
  section(fullName: string, kind: DronecanSectionKind): DronecanSectionDesc {
    const entry = this.data.types[fullName]
    const section = entry?.[kind]
    if (!section) throw new DronecanCodecError(`${fullName} has no ${kind} section.`)
    return section
  }

  /**
   * Decode a transfer payload (CRC stripped). TAO is on for classic CAN
   * transfers and off for CAN FD.
   */
  decode(fullName: string, kind: DronecanSectionKind, payload: Uint8Array, options: { tao?: boolean } = {}): { [field: string]: DronecanValue } {
    return decodeDronecanSection(this.section(fullName, kind), payload, this.resolve, options.tao ?? true)
  }

  encode(
    fullName: string,
    kind: DronecanSectionKind,
    value: { [field: string]: DronecanValue },
    options: { tao?: boolean } = {}
  ): Uint8Array {
    return encodeDronecanSection(this.section(fullName, kind), value, this.resolve, options.tao ?? true)
  }

  private readonly resolve = (fullName: string): DronecanSectionDesc => this.section(fullName, 'msg')
}

function toInfo(fullName: string, entry: DronecanTypeEntry): DronecanTypeInfo {
  return {
    fullName,
    shortName: fullName.slice(fullName.lastIndexOf('.') + 1),
    kind: entry.k === 'm' ? 'message' : 'service',
    dataTypeId: entry.id,
    signature: BigInt(`0x${entry.sig}`)
  }
}

let shared: DronecanCatalogue | undefined

/** The catalogue built from the bundled DSDL (constructed once, on first use). */
export function dronecanCatalogue(): DronecanCatalogue {
  shared ??= new DronecanCatalogue()
  return shared
}
