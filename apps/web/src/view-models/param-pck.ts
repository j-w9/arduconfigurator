// Parser for ArduPilot's MAVFTP `@PARAM/param.pck?withdefaults=1` download —
// the reliable way (4.5+) to know which params differ from firmware default.
//
// Format (libraries/AP_Filesystem/AP_Filesystem_Param.cpp, uncompressed):
//   header: magic u16 LE (0x671b = no defaults, 0x671c = with defaults),
//           num_params u16, total_params u16.  (6 bytes)
//   per entry:
//     [pad] zero bytes may precede an entry (type nibble 0 = skip one)
//     b0: low nibble = type (1:INT8 2:INT16 3:INT32 4:FLOAT), high nibble = flags
//         (bit0 = "has default" — set ONLY when the value differs from its
//         default, so a set flag == this param is NON-DEFAULT)
//     b1: low nibble = common prefix length shared with the previous name,
//         high nibble = (name_len - 1)
//     name suffix: name_len bytes (append to prev-name[0..common])
//     value: type_len bytes, little-endian (int8/16/32 signed, float32)
//     default: type_len bytes, only when the flag is set (we skip it)

export interface ParamPckEntry {
  name: string
  value: number
  /** FC flagged this param as differing from its default (i.e. non-default). */
  nonDefault: boolean
}

export interface ParamPckResult {
  withDefaults: boolean
  entries: ParamPckEntry[]
  /** Names the FC reported as non-default (empty when !withDefaults). */
  nonDefaultParamIds: Set<string>
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 4 }

export function isParamPck(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false
  const magic = bytes[0] | (bytes[1] << 8)
  return magic === 0x671b || magic === 0x671c
}

export function parseParamPck(bytes: Uint8Array): ParamPckResult {
  if (!isParamPck(bytes)) {
    throw new Error('Not a param.pck (bad magic)')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const withDefaults = (bytes[0] | (bytes[1] << 8)) === 0x671c

  const entries: ParamPckEntry[] = []
  const nonDefaultParamIds = new Set<string>()
  let lastName = ''
  let ofs = 6 // sizeof(header)

  while (ofs < bytes.length) {
    const b0 = bytes[ofs]
    const type = b0 & 0x0f
    if (type === 0) {
      ofs += 1 // padding byte (AP_PARAM_NONE) — skip
      continue
    }
    const typeSize = TYPE_SIZE[type]
    if (typeSize === undefined) break // unknown type — stop defensively
    if (ofs + 2 > bytes.length) break

    const hasDefault = (b0 & 0x10) !== 0
    const b1 = bytes[ofs + 1]
    const commonLen = b1 & 0x0f
    const nameLen = (b1 >> 4) + 1

    const suffixOfs = ofs + 2
    const valueOfs = suffixOfs + nameLen
    let next = valueOfs + typeSize
    if (hasDefault) next += typeSize
    if (next > bytes.length) break // truncated entry

    let suffix = ''
    for (let i = 0; i < nameLen; i += 1) {
      suffix += String.fromCharCode(bytes[suffixOfs + i])
    }
    const name = lastName.slice(0, commonLen) + suffix
    lastName = name

    entries.push({ name, value: readTypedValue(view, valueOfs, type), nonDefault: hasDefault })
    if (hasDefault) {
      nonDefaultParamIds.add(name)
    }
    ofs = next
  }

  return { withDefaults, entries, nonDefaultParamIds }
}

function readTypedValue(view: DataView, ofs: number, type: number): number {
  switch (type) {
    case 1:
      return view.getInt8(ofs)
    case 2:
      return view.getInt16(ofs, true)
    case 3:
      return view.getInt32(ofs, true)
    case 4:
      return view.getFloat32(ofs, true)
    default:
      return Number.NaN
  }
}
