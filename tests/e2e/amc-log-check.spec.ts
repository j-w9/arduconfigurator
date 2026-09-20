import { expect, test } from '@playwright/test'

// Checking a flight log for the messages a step should have produced.
//
// Several steps configure something whose only proof is in the log — ESC
// telemetry either arrives or it does not — and the sequence names the
// messages each one depends on. The check itself is unit-tested in the fork;
// what only a browser can answer is whether a file the operator picks is
// actually read and parsed here, with the parser dynamic-imported.

const HEAD1 = 0xa3
const HEAD2 = 0x95
const FMT_TYPE = 0x80

function padBytes(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < text.length && i < length; i += 1) out[i] = text.charCodeAt(i)
  return out
}

/** A FMT record is always 89 bytes; see log-analysis-dataflash.test.mjs. */
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

/** One ESC message: head(2) type(1) + a single uint32 field. */
function escRecord(value: number): Uint8Array {
  const buf = new Uint8Array(7)
  const view = new DataView(buf.buffer)
  buf[0] = HEAD1
  buf[1] = HEAD2
  buf[2] = 0x01
  view.setUint32(3, value, true)
  return buf
}

/** A minimal but genuine DataFlash log holding ESC messages and nothing else. */
function buildLog(escCount: number): Buffer {
  const chunks: Uint8Array[] = [
    fmtRecord(FMT_TYPE, 89, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns'),
    fmtRecord(0x01, 7, 'ESC', 'I', 'TimeUS')
  ]
  for (let i = 0; i < escCount; i += 1) chunks.push(escRecord(i))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return Buffer.from(out)
}

test('a flight log marks which steps have the evidence they need', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('button', { name: /Esc telemetry/i })).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('amc-open-log').setInputFiles({
    name: '00000042.BIN',
    mimeType: 'application/octet-stream',
    buffer: buildLog(1200)
  })

  // The file was read here, in the browser, and nothing was uploaded.
  await expect(page.getByText(/00000042\.BIN: \d+ message types/)).toBeVisible({ timeout: 30_000 })

  // The ESC step's evidence is complete: the log holds the messages it names.
  await page.getByRole('button', { name: /Esc telemetry/i }).click()
  const verdict = page.getByText(/The flight log has everything this step should produce/)
  await expect(verdict).toBeVisible()

  // The per-message counts live inside the collapsed <details> the verdict
  // summarises, so opening it is what an operator does to see the working.
  await verdict.click()
  await expect(page.getByText(/1,200 in the log/)).toBeVisible()

  // And a step whose required message is absent says so rather than staying
  // silent — this log has no GPS messages at all.
  await page.getByRole('button', { name: /Gnss/i }).first().click()
  await expect(page.getByText(/The flight log is missing \d+ message/)).toBeVisible()
})

test('a file that is not a log says so rather than failing quietly', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('button', { name: /Esc telemetry/i })).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('amc-open-log').setInputFiles({
    name: 'notes.BIN',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('this is not a dataflash log at all')
  })

  await expect(page.getByText(/holds no recognisable messages/)).toBeVisible({ timeout: 30_000 })
})
