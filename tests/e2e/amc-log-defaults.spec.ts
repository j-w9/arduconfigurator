import { expect, test } from '@playwright/test'

// Taking the firmware's defaults out of a flight log.
//
// A step can only take account of what the operator has already changed, which
// means knowing what "unchanged" is. That normally comes off the vehicle over
// MAVFTP — a live connection, and the part of this most likely to fail. A log
// carries the same answer in its PARM records, which AMC reads the same way
// (extract_param_defaults). The reading is unit-tested in the fork; what only
// a browser can answer is whether a real .bin the operator picks is parsed
// here and actually reaches the steps.

const HEAD1 = 0xa3
const HEAD2 = 0x95
const FMT_TYPE = 0x80
const PARM_TYPE = 0x02

function padBytes(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < text.length && i < length; i += 1) out[i] = text.charCodeAt(i)
  return out
}

function fmtRecord(definedType: number, length: number, name: string, format: string, columns: string): Uint8Array {
  const buf = new Uint8Array(89)
  buf[0] = HEAD1
  buf[1] = HEAD2
  buf[2] = FMT_TYPE
  buf[3] = definedType
  buf[4] = length
  buf.set(padBytes(name, 4), 5)
  buf.set(padBytes(format, 16), 9)
  buf.set(padBytes(columns, 64), 25)
  return buf
}

/**
 * One PARM record, as ArduPilot writes it: QNff.
 *
 * The `Default` column is the whole point — it is what makes a log an answer
 * to "what would this parameter be if nobody had touched it".
 */
function parmRecord(name: string, value: number, fallback: number): Uint8Array {
  const buf = new Uint8Array(3 + 8 + 16 + 4 + 4)
  const view = new DataView(buf.buffer)
  buf[0] = HEAD1
  buf[1] = HEAD2
  buf[2] = PARM_TYPE
  view.setBigUint64(3, 0n, true)
  buf.set(padBytes(name, 16), 11)
  view.setFloat32(27, value, true)
  view.setFloat32(31, fallback, true)
  return buf
}

function buildLog(params: readonly (readonly [string, number, number])[]): Buffer {
  const chunks: Uint8Array[] = [
    fmtRecord(FMT_TYPE, 89, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns'),
    fmtRecord(PARM_TYPE, 35, 'PARM', 'QNff', 'TimeUS,Name,Value,Default')
  ]
  for (const [name, value, fallback] of params) chunks.push(parmRecord(name, value, fallback))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return Buffer.from(out)
}

test("a log's PARM records supply the defaults the steps need", async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('button', { name: /Board orientation/i })).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('amc-open-log').setInputFiles({
    name: '00000043.BIN',
    mimeType: 'application/octet-stream',
    buffer: buildLog([
      ['INS_LOG_BAT_MASK', 1, 0],
      ['LOG_BITMASK', 176126, 180222],
      // Untouched: present, and deliberately not counted as changed.
      ['ATC_RAT_RLL_P', 0.135, 0.135]
    ])
  })

  // Three defaults read, two of which the operator had already moved.
  await expect(page.getByText(/3 firmware defaults/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/2 you have already changed/)).toBeVisible()
})

test('a log from a build that records no defaults says so', async ({ page }) => {
  // The operator has done the right thing and it still cannot help them, which
  // is worth saying rather than leaving the steps quietly asking for a vehicle.
  const chunks: Uint8Array[] = [
    fmtRecord(FMT_TYPE, 89, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns'),
    // Same message, without the Default column older firmware omits.
    fmtRecord(PARM_TYPE, 31, 'PARM', 'QNf', 'TimeUS,Name,Value')
  ]
  const record = new Uint8Array(31)
  const view = new DataView(record.buffer)
  record[0] = HEAD1
  record[1] = HEAD2
  record[2] = PARM_TYPE
  view.setBigUint64(3, 0n, true)
  record.set(padBytes('LOG_BITMASK', 16), 11)
  view.setFloat32(27, 176126, true)
  chunks.push(record)

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }

  await page.goto('/')
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('button', { name: /Board orientation/i })).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('amc-open-log').setInputFiles({
    name: '00000044.BIN',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(out)
  })

  await expect(page.getByText(/no firmware defaults/)).toBeVisible({ timeout: 30_000 })
})
