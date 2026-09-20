import { expect, test } from '@playwright/test'

// IMU temperature calibration, fitted from a flight log in the browser.
//
// Three of the sequence's steps are this: set it up, fly a cool-to-warm
// profile, write the results. The fit and its refusals are unit-tested in the
// fork (against numpy); what only a browser answers is whether a .bin the
// operator picks reaches the fit and the result reaches the step.

const HEAD1 = 0xa3
const HEAD2 = 0x95
const FMT_TYPE = 0x80

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

/** head(2) type(1) + I:uint8 + six floats + T:float = 32 bytes. */
function imuRecord(instance: number, gyro: [number, number, number], accel: [number, number, number], temp: number): Uint8Array {
  const buf = new Uint8Array(32)
  const view = new DataView(buf.buffer)
  buf[0] = HEAD1
  buf[1] = HEAD2
  buf[2] = 0x02
  view.setUint8(3, instance)
  const values = [...gyro, ...accel, temp]
  values.forEach((value, i) => view.setFloat32(4 + i * 4, value, true))
  return buf
}

/** A log whose IMU warms from 5 °C to 65 °C with a known linear gyro drift. */
function buildTempcalLog(samples: number): Buffer {
  const chunks: Uint8Array[] = [
    fmtRecord(FMT_TYPE, 89, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns'),
    fmtRecord(0x02, 32, 'IMU', 'Bfffffff', 'I,GyrX,GyrY,GyrZ,AccX,AccY,AccZ,T')
  ]
  for (let i = 0; i < samples; i += 1) {
    const t = 5 + (60 * i) / (samples - 1)
    const drift = 0.002 + 0.0001 * (t - 35)
    chunks.push(imuRecord(0, [drift, 0, 0], [0.1, 0.2, 9.8], t))
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return Buffer.from(out)
}

test('a log with an IMU temperature sweep fits a calibration', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('button', { name: /Imu temperature calibration results/i })).toBeVisible({
    timeout: 20_000
  })

  await page.getByTestId('amc-open-log').setInputFiles({
    name: '00000007.BIN',
    mimeType: 'application/octet-stream',
    buffer: buildTempcalLog(120)
  })

  // The fit happens on load, so the step can offer it without asking for the
  // same file twice.
  await expect(page.getByText(/IMU temperature calibration fitted for 1 IMU/)).toBeVisible({
    timeout: 30_000
  })

  await page.getByRole('button', { name: /Imu temperature calibration results/i }).click()
  await expect(page.getByText(/Fitted from your log: 1 IMU over 60\.0 °C/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Stage \d+ calibration values/ })).toBeVisible()
})

test('a log whose IMU barely warmed says why it was not calibrated', async ({ page }) => {
  // A confident calibration from a narrow range is worse than none: ArduPilot
  // would apply a curve fitted to noise at every temperature.
  await page.goto('/')
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('button', { name: /Imu temperature calibration results/i })).toBeVisible({
    timeout: 20_000
  })

  const chunks: Uint8Array[] = [
    fmtRecord(FMT_TYPE, 89, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns'),
    fmtRecord(0x02, 32, 'IMU', 'Bfffffff', 'I,GyrX,GyrY,GyrZ,AccX,AccY,AccZ,T')
  ]
  for (let i = 0; i < 60; i += 1) {
    chunks.push(imuRecord(0, [0.002, 0, 0], [0.1, 0.2, 9.8], 30 + (3 * i) / 59))
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const flat = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    flat.set(chunk, offset)
    offset += chunk.length
  }

  await page.getByTestId('amc-open-log').setInputFiles({
    name: '00000008.BIN',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(flat)
  })

  await page.getByRole('button', { name: /Imu temperature calibration results/i }).click()
  await expect(page.getByText(/IMU 1 was not calibrated .* only moved 3\.0 °C/)).toBeVisible({
    timeout: 30_000
  })
})
