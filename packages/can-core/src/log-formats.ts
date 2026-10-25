// Recording formats.
//
// candump -L (can-utils) is the format the Linux CAN tooling reads and writes
// -- canplayer, SavvyCAN, cantools, python-can all load it -- so a recording
// made here opens elsewhere, and a log captured elsewhere opens here:
//
//   (1436509052.249713) can0 123#DEADBEEF        classic, standard id
//   (1436509052.249713) can0 1E0A3C7F#00FF        classic, extended id (8 digits)
//   (1436509052.249713) can0 123#R                remote frame
//   (1436509052.249713) can0 123##1DEADBEEF       CAN FD: '##', then a flags nibble
//
// Bus N here is canN-1 there (ArduPilot numbers its buses from 1).
// CSV is for spreadsheets; it also records the direction, which candump -L has
// no field for.

import {
  CAN_ERR_FLAG,
  canFrameFromRawId,
  formatCanData,
  formatCanId,
  type CanFrame
} from './frame.js'

function hex(data: Uint8Array): string {
  return formatCanData(data).replace(/ /g, '')
}

/** One candump -L line for a frame. */
export function formatCandumpLine(frame: CanFrame): string {
  const seconds = (frame.timestampMs / 1000).toFixed(6)
  const iface = `can${Math.max(0, frame.bus - 1)}`
  const id = frame.error
    ? ((frame.id | CAN_ERR_FLAG) >>> 0).toString(16).toUpperCase().padStart(8, '0')
    : formatCanId(frame.id, frame.extended)
  const body = frame.rtr ? 'R' : frame.fd ? `#0${hex(frame.data)}` : hex(frame.data)
  return `(${seconds}) ${iface} ${id}#${body}`
}

export function formatCandump(frames: Iterable<CanFrame>): string {
  const lines: string[] = []
  for (const frame of frames) lines.push(formatCandumpLine(frame))
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

export interface CandumpParseResult {
  frames: CanFrame[]
  /** 1-based line numbers that were not a frame (comments and blanks are not counted). */
  skippedLines: number[]
}

// The body is 'R' (remote) or hex; some can-utils builds append a
// whitespace-separated R/T direction marker, which is ignored.
const CANDUMP_LINE = /^\((\d+(?:\.\d+)?)\)\s+(\S+)\s+([0-9A-Fa-f]{1,8})#(#?)(R\d*|[0-9A-Fa-f]*)(?:\s+[RT])?\s*$/

/** Parse a candump -L log. Interfaces named canN / vcanN / slcanN map to bus N+1. */
export function parseCandump(text: string): CandumpParseResult {
  const frames: CanFrame[] = []
  const skippedLines: number[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '' || line.startsWith('#')) continue
    const match = CANDUMP_LINE.exec(line)
    if (!match) {
      skippedLines.push(index + 1)
      continue
    }
    const [, secondsText, iface, idText, fdMarker, bodyText] = match
    const busMatch = /(\d+)$/.exec(iface)
    const bus = busMatch ? Number(busMatch[1]) + 1 : 1
    const idValue = Number.parseInt(idText, 16) >>> 0
    // An 8-digit id with the error flag is an error frame (candump writes them
    // with the flag in the id); otherwise more than 3 digits means extended.
    const error = idText.length === 8 && (idValue & CAN_ERR_FLAG) !== 0
    const extended = !error && idText.length > 3
    const fd = fdMarker === '#'
    const remote = !fd && bodyText.startsWith('R')
    const payloadHex = fd ? bodyText.slice(1) : remote ? '' : bodyText
    if (payloadHex.length % 2 !== 0) {
      skippedLines.push(index + 1)
      continue
    }
    const data = new Uint8Array(payloadHex.length / 2)
    for (let byte = 0; byte < data.length; byte += 1) {
      data[byte] = Number.parseInt(payloadHex.slice(byte * 2, byte * 2 + 2), 16)
    }
    let rawId = error ? (idValue & 0x1fffffff) | CAN_ERR_FLAG : idValue & (extended ? 0x1fffffff : 0x7ff)
    if (extended) rawId |= 0x80000000
    if (remote) rawId |= 0x40000000
    frames.push(
      canFrameFromRawId({
        timestampMs: Number(secondsText) * 1000,
        bus,
        rawId: rawId >>> 0,
        data,
        fd
      })
    )
  }
  return { frames, skippedLines }
}

const CSV_HEADER = 'timestamp_s,bus,direction,id,extended,fd,remote,error,length,data'

/** CSV with a header row; one frame per line. */
export function formatCanCsv(frames: Iterable<CanFrame>): string {
  const rows = [CSV_HEADER]
  for (const frame of frames) {
    rows.push(
      [
        (frame.timestampMs / 1000).toFixed(6),
        frame.bus,
        frame.direction,
        formatCanId(frame.id, frame.extended),
        frame.extended ? 1 : 0,
        frame.fd ? 1 : 0,
        frame.rtr ? 1 : 0,
        frame.error ? 1 : 0,
        frame.data.length,
        formatCanData(frame.data)
      ].join(',')
    )
  }
  return `${rows.join('\n')}\n`
}

export interface CanLogParseResult {
  format: 'candump' | 'csv'
  frames: CanFrame[]
  skippedLines: number[]
}

/** Parse this app's CSV export back into frames (header row required). */
export function parseCanCsv(text: string): CandumpParseResult {
  const frames: CanFrame[] = []
  const skippedLines: number[] = []
  const lines = text.split(/\r?\n/)
  const header = (lines[0] ?? '').trim()
  if (header !== CSV_HEADER) {
    return { frames, skippedLines: lines.length > 0 ? [1] : [] }
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '') continue
    const cells = line.split(',')
    if (cells.length !== 10) {
      skippedLines.push(index + 1)
      continue
    }
    const [seconds, bus, direction, idText, extended, fd, remote, error, length, dataText] = cells
    const id = Number.parseInt(idText, 16)
    const bytes = dataText.trim() === '' ? [] : dataText.trim().split(/\s+/).map((byte) => Number.parseInt(byte, 16))
    if (
      !Number.isFinite(Number(seconds)) ||
      !Number.isFinite(id) ||
      bytes.some((byte) => !Number.isFinite(byte) || byte < 0 || byte > 255) ||
      bytes.length !== Number(length) ||
      (direction !== 'rx' && direction !== 'tx')
    ) {
      skippedLines.push(index + 1)
      continue
    }
    let rawId = extended === '1' ? (id & 0x1fffffff) | 0x80000000 : id & 0x7ff
    if (remote === '1') rawId |= 0x40000000
    if (error === '1') rawId |= CAN_ERR_FLAG
    frames.push(
      canFrameFromRawId({
        timestampMs: Number(seconds) * 1000,
        bus: Number(bus) || 1,
        rawId: rawId >>> 0,
        data: Uint8Array.from(bytes),
        fd: fd === '1',
        direction
      })
    )
  }
  return { frames, skippedLines }
}

/**
 * Parse a recorded log of either format: this app's CSV (recognised by its
 * header row) or candump -L. Frames come back in timestamp order, which a log
 * merged from several sources does not always guarantee.
 */
export function parseCanLog(text: string): CanLogParseResult {
  const firstLine = text.slice(0, 200).split(/\r?\n/, 1)[0]?.trim() ?? ''
  const format = firstLine === CSV_HEADER ? 'csv' : 'candump'
  const parsed = format === 'csv' ? parseCanCsv(text) : parseCandump(text)
  const frames = [...parsed.frames].sort((left, right) => left.timestampMs - right.timestampMs)
  return { format, frames, skippedLines: parsed.skippedLines }
}
