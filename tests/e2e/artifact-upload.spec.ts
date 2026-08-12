import { expect, test, type Page } from '@playwright/test'

// Naming a configuration upload before it is filed.
//
// The button only exists when the operator has a log-server session, which is
// why this surface had no e2e coverage at all: there was no signed-in state to
// drive. Rather than add a test-only seam to the app, the session is seeded
// straight into sessionStorage — it is plain JSON written by
// `log-upload/session-storage.ts`, so seeding it exercises the REAL load path
// (including its expiry check) instead of a parallel one built for tests.
//
// The server is a route intercept. That is deliberate: the assertion that
// matters is what the app SENDS — the operator's edited name has to reach the
// request body, and the export content has to arrive byte-for-byte — and only
// the outbound request can show that.

const SESSION_KEY = 'arduconfig:log-server-session'
const SERVER = 'https://logs.example.test'

const VEHICLE_CONNECT_TIMEOUT = 30_000

/** Sign in, as far as the app is concerned. */
async function seedLogServerSession(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, server]) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          serverUrl: server,
          username: 'testpilot',
          token: 'test-token',
          // Comfortably ahead, so the loader's expiry check passes rather than
          // silently dropping the session and hiding the button under a green
          // test.
          expiresAtMs: Date.now() + 60 * 60 * 1000
        })
      )
    },
    [SESSION_KEY, SERVER] as const
  )
}

interface Captured {
  bodies: Array<Record<string, unknown>>
}

/** Stand in for the log server, and record what it was sent. */
async function interceptUploads(page: Page): Promise<Captured> {
  const captured: Captured = { bodies: [] }
  await page.route(`${SERVER}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      try {
        captured.bodies.push(JSON.parse(request.postData() ?? '{}'))
      } catch {
        captured.bodies.push({ unparseable: request.postData() })
      }
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'artifact-1',
        kind: 'parameters',
        sha256: 'a'.repeat(64),
        sizeBytes: 1234,
        url: `${SERVER}/files/artifact-1`
      })
    })
  })
  return captured
}

/**
 * Connect the demo vehicle and open Parameters.
 *
 * Expert mode is REQUIRED, not incidental: the Parameters view is gated behind
 * it, so without the toggle `view-button-parameters` never exists and every
 * test here times out waiting for a tab that is not on the page.
 */
async function openParameters(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  await page.getByTestId('product-mode-expert').check()
  await page.getByTestId('view-button-parameters').click()
}

test.describe('Naming a configuration upload', () => {
  test('the button stays hidden until there is a log server to upload to', async ({ page }) => {
    // The point of the button rendering nothing without a session: a control
    // that only ever says "sign in first" advertises a capability most
    // operators have not set up.
    await openParameters(page)
    await expect(page.getByTestId('upload-parameter-backup-button')).toHaveCount(0)
  })

  test('opens a form prefilled with the derived name, and sends what was typed', async ({ page }) => {
    await seedLogServerSession(page)
    const captured = await interceptUploads(page)
    await openParameters(page)

    const button = page.getByTestId('upload-parameter-backup-button')
    await expect(button).toBeVisible()
    await button.click()

    const form = page.getByTestId('upload-parameter-backup-button-form')
    await expect(form).toBeVisible()

    // Prefilled, so the one-click path survives: the operator can just submit.
    const name = page.getByTestId('upload-parameter-backup-button-name')
    const prefilled = await name.inputValue()
    expect(prefilled.length).toBeGreaterThan(0)
    expect(prefilled).not.toContain('.json')

    // The folder is shown but not chosen — same as a log upload.
    await expect(page.getByTestId('upload-parameter-backup-button-folder')).toBeVisible()

    await name.fill('after the autotune')
    await page.getByTestId('upload-parameter-backup-button-note').fill('second pack, windy')
    await page.getByTestId('upload-parameter-backup-button-submit').click()

    await expect(page.getByTestId('upload-parameter-backup-button-status')).toBeVisible()
    expect(captured.bodies).toHaveLength(1)
    const body = captured.bodies[0]
    // What the operator typed reaches the server, normalised and with the
    // extension re-attached rather than doubled or dropped.
    expect(body.fileName).toBe('after-the-autotune.json')
    expect(body.note).toBe('second pack, windy')
    expect(typeof body.content).toBe('string')
  })

  test('a typed name cannot climb out of its folder', async ({ page }) => {
    // Path traversal through a filename is the one input here that could reach
    // outside where it belongs, so it is asserted end-to-end and not only in
    // the view-model unit tests.
    await seedLogServerSession(page)
    const captured = await interceptUploads(page)
    await openParameters(page)

    await page.getByTestId('upload-parameter-backup-button').click()
    await page.getByTestId('upload-parameter-backup-button-name').fill('../../etc/passwd')
    await page.getByTestId('upload-parameter-backup-button-submit').click()

    await expect(page.getByTestId('upload-parameter-backup-button-status')).toBeVisible()
    expect(captured.bodies).toHaveLength(1)
    const fileName = String(captured.bodies[0].fileName)
    expect(fileName).not.toContain('..')
    expect(fileName).not.toContain('/')
  })

  test('cancel closes the form without uploading anything', async ({ page }) => {
    await seedLogServerSession(page)
    const captured = await interceptUploads(page)
    await openParameters(page)

    await page.getByTestId('upload-parameter-backup-button').click()
    await expect(page.getByTestId('upload-parameter-backup-button-form')).toBeVisible()
    await page.getByTestId('upload-parameter-backup-button-cancel').click()
    await expect(page.getByTestId('upload-parameter-backup-button-form')).toHaveCount(0)
    expect(captured.bodies).toHaveLength(0)
  })

  test('on a phone it goes with the export controls, not without them', async ({ page }) => {
    // A phone used to be able to UPLOAD a parameter backup it could not
    // export: the export control is hidden below 600px as a desktop task, and
    // this button — the same desktop task — was left behind beside it.
    await page.setViewportSize({ width: 390, height: 844 })
    await seedLogServerSession(page)
    await interceptUploads(page)
    await openParameters(page)

    await expect(page.getByTestId('export-parameter-backup')).toBeHidden()
    await expect(page.getByTestId('upload-parameter-backup-button')).toBeHidden()
  })

  test('the form does not overflow at the narrowest width that shows it', async ({ page }) => {
    // 601px: one pixel above the phone cutoff, so this is the tightest the
    // form is ever asked to lay out. The gap it closes is that the inline form
    // was reasoned about from CSS and never actually rendered narrow.
    await page.setViewportSize({ width: 601, height: 844 })
    await seedLogServerSession(page)
    await interceptUploads(page)
    await openParameters(page)

    await page.getByTestId('upload-parameter-backup-button').click()
    await expect(page.getByTestId('upload-parameter-backup-button-form')).toBeVisible()

    // The house page-level gate, as used elsewhere for phone width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'the open upload form must not widen the page').toBeLessThanOrEqual(2)

    // And an ELEMENT-level check, because the page-level one cannot see this
    // particular form: an ancestor clips horizontally, so a form 1200px wide
    // leaves documentElement.scrollWidth completely unchanged. Verified by
    // forcing exactly that and watching the page-level number not move. The
    // form's own right edge does react, so that is what is asserted.
    const box = await page.getByTestId('upload-parameter-backup-button-form').boundingBox()
    expect(box, 'the form should be laid out').not.toBeNull()
    expect(
      Math.round(box!.x + box!.width),
      'the open upload form must fit the narrowest width that shows it'
    ).toBeLessThanOrEqual(601)
  })
})
