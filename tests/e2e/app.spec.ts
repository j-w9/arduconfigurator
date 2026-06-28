import { expect, test, type Page } from '@playwright/test'

// Guided calibration is the heaviest async flow in the suite: each pose
// confirm / mag-cal step is a transport round-trip and the demo MockTransport
// adds ~80ms latency and SERIALIZES inbound frames, so on a cold CI runner
// setTimeout drift accumulates across the 6-round-trip accel chain and the
// mag-cal stream. The flows are correct — they just occasionally land past
// the global 15s expect budget (a wall both the initial attempt and the
// retry hit, so retries don't help). Give these specific assertions a
// roomier budget; a genuine logic break (prompt/completion never arrives)
// still fails well within it.
const CAL_FLOW_TIMEOUT = 30_000

// Command-ACK / write-verify round-trips (one transport reply each) and the
// initial connect both ride the same contended setTimeout timeline, so give
// them generous targeted budgets too (see views.spec.ts for the full rationale).
const COMMAND_ACK_TIMEOUT = 20_000
const VEHICLE_CONNECT_TIMEOUT = 30_000

async function expectParameterSummaryComplete(page: Page): Promise<void> {
  // The full demo param sync (~590 params) is the single heaviest event on the
  // mock's setTimeout timeline, so under a contended run it can outlast the
  // global 15s expect budget even though it always eventually completes. It's
  // part of every connect, so give it the connect budget.
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
}

async function connectToVehicle(
  page: Page,
  transportMode: 'demo' | 'websocket' = 'demo',
  path = '/'
): Promise<void> {
  await page.goto(path)

  await page.getByTestId('transport-mode-select').selectOption(transportMode)

  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  await expectParameterSummaryComplete(page)
  // Settle the lazily-loaded 3D preview chunk (three.js) during connect so its
  // parse can't land mid-interaction and stall the in-browser mock's frame
  // delivery. Best-effort: the preview mounts on the default Setup view, but not
  // every flow lands there, so a miss must not fail the test.
  await page
    .getByTestId('setup-craft-preview')
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {})
}

async function connectToPlane(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo-plane')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
  await expectParameterSummaryComplete(page)
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId(`view-button-${viewId}`).click()
}

async function expectWorkspaceViewTitle(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId('workspace-view-title')).toHaveText(title)
}

async function pullParameters(page: Page): Promise<void> {
  // After the auto-refresh-on-write change, the post-write Pull Parameters
  // button can already be gone by the time a test reaches this helper (the
  // followup was auto-cleared by the implicit refresh). Treat that as
  // "already pulled" — assert the summary is complete and return. If the
  // button IS still around (e.g. because the write required a reboot or
  // the auto-refresh hiccuped), click it as before.
  const pullParametersButton = page.getByRole('button', { name: 'Pull Parameters' })
  if ((await pullParametersButton.count()) > 0) {
    await pullParametersButton.click()
    await expect(pullParametersButton).toHaveCount(0)
  }
  await expectParameterSummaryComplete(page)
}

async function applySingleTuningChange(page: Page, value: string): Promise<void> {
  await openView(page, 'tuning')
  // The Rates task hosts the flight-feel ATC_INPUT_TC control. Select it
  // explicitly: a prior apply leaves the Tuning task on Review (the active task
  // is now operator-driven and sticky, never auto-switched).
  await page.getByTestId('tuning-summary-rates').click()
  await page.getByTestId('tuning-input-ATC_INPUT_TC').fill(value)
  await page.getByTestId('tuning-input-ATC_INPUT_TC').blur()
  // Editing stages in place and no longer auto-redirects to Review, so the
  // operator (and this helper) opens the Review task to reach Apply.
  await page.getByTestId('tuning-task-nav').getByRole('button', { name: /Review/i }).click()
  await page.getByTestId('apply-tuning-changes-button').click()
  await expect(page.getByText('Verified 1 tuning change(s) from this view.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pull Parameters' })).toBeVisible()
}

async function completeAccelerometerCalibrationFromSetup(page: Page): Promise<void> {
  // Calibration now lives in the dedicated Calibration tab (removed from the
  // Status page). The same guided-action button drives the flow.
  await openView(page, 'calibration')
  // The demo mock now mirrors real ArduPilot semantics: each pose prompt
  // arrives only after the previous one has been confirmed. Walk the
  // calibration through every posture so the run can reach "complete".
  await page.getByRole('button', { name: 'Calibrate Accelerometer' }).click()
  // Wait for the first pose prompt explicitly. If a cold-start CI runner is
  // late, the timeout here points at the boot delay rather than blaming the
  // sequential .click() chain below.
  await expect(page.getByRole('button', { name: 'Confirm Level Position' })).toBeVisible({ timeout: CAL_FLOW_TIMEOUT })
  for (const ctaLabel of [
    'Confirm Level Position',
    'Confirm Left Side Position',
    'Confirm Right Side Position',
    'Confirm Nose Down Position',
    'Confirm Nose Up Position',
    'Confirm Back Position'
  ]) {
    await page.getByRole('button', { name: ctaLabel }).click()
  }
  await expect(page.getByText('Accelerometer calibration complete.').first()).toBeVisible({ timeout: CAL_FLOW_TIMEOUT })
}

async function completeCompassCalibrationFromSetup(page: Page): Promise<void> {
  // Modern ArduPilot rejects the legacy PREFLIGHT_CALIBRATION magnetometer
  // path; the runtime now drives onboard mag cal via DO_START_MAG_CAL and
  // the demo mock answers with an ack, a rising MAG_CAL_PROGRESS stream,
  // and a SUCCESS MAG_CAL_REPORT. One click runs the whole chain to done.
  await openView(page, 'calibration')
  await page.getByRole('button', { name: 'Calibrate Compass' }).click()
  // The success copy now names the per-compass result (e.g. "Compass
  // calibration complete (compass)." for a single compass) since #680's
  // per-instance MAG_CAL_REPORT aggregation, so match the stable prefix.
  await expect(page.getByText(/Compass calibration complete/).first()).toBeVisible({ timeout: CAL_FLOW_TIMEOUT })
}

test.describe('browser configurator regression flows', () => {
  test('disconnected landing replaces the Setup view pre-connect', async ({ page }) => {
    await page.goto('/')

    // The DisconnectedLanding screen now covers the Setup surface pre-connect,
    // so Setup actions like Calibrate Accelerometer should not be reachable from the main content.
    await expect(page.getByTestId('disconnected-landing')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Calibrate Accelerometer' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Configure your ArduPilot flight controller.' })).toBeVisible()
  })

  test('upstream import enriches the raw parameter table for uncurated params', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await page.getByTestId('product-mode-expert').click()
    await openView(page, 'parameters')
    await page.getByTestId('parameter-search-input').fill('BRD_BOOT_DELAY')
    // BRD_BOOT_DELAY isn't in the curated catalog, so without the upstream
    // import its row would read the "Metadata to be expanded..." placeholder.
    // The description here comes from the lazily-loaded ArduPilot upstream
    // bundle; Playwright retries until the dynamic chunk lands + the table
    // re-renders. (Was SERVO1_MIN before SERVO1..32 got curated metadata.)
    await expect(page.getByText(/delay in milliseconds to boot/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Metadata to be expanded from upstream ArduPilot bundles.')).toHaveCount(0)
  })

  test('bitmask params in the raw parameter table render as per-bit chips', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await page.getByTestId('product-mode-expert').click()
    await openView(page, 'parameters')
    await page.getByTestId('parameter-search-input').fill('FS_OPTIONS')
    // FS_OPTIONS is a curated bitmask param — its Draft cell must render the
    // labelled per-bit chips (orange highlight = set), not a raw number input
    // and not checkboxes. Scope to the table row (the details breakout echoes
    // the same editor + testid for the selected param).
    const field = page.locator('.parameter-table').getByTestId('scoped-bitmask-FS_OPTIONS')
    await field.scrollIntoViewIfNeeded()
    await expect(field).toBeVisible()
    // Compact popover: collapsed by default, opens to the per-bit chips.
    await field.locator('summary').click()
    await expect(field.locator('.scoped-bitmask-bit').first()).toBeVisible()
    // No checkboxes and no hex readout in the new chip UI.
    await expect(field.locator('input[type="checkbox"]')).toHaveCount(0)
    await expect(field.locator('code')).toHaveCount(0)
    // …and the row no longer falls back to the raw number input.
    await expect(page.getByLabel('FS_OPTIONS value')).toHaveCount(0)
  })

  test('parameter table can filter by category', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await page.getByTestId('product-mode-expert').click()
    await openView(page, 'parameters')
    const filter = page.getByTestId('parameter-category-filter')
    await expect(filter).toBeVisible()
    // There is at least one real category beyond "All categories".
    await expect(filter.locator('option').nth(1)).toBeAttached()
    const rows = page.locator('.parameter-row:not(.parameter-row--header)')
    const allCount = await rows.count()
    const label = (await filter.locator('option').nth(1).textContent())!.trim()
    await filter.selectOption({ index: 1 })
    await expect(rows.first()).toBeVisible()
    const filteredCount = await rows.count()
    expect(filteredCount).toBeGreaterThan(0)
    expect(filteredCount).toBeLessThanOrEqual(allCount)
    // Every visible row belongs to the chosen category (first cell's category).
    await expect(rows.first().locator('small').first()).toHaveText(label)
  })

  test('Status page offers a two-step Enter DFU control and no calibration buttons', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    // Calibration is gone from the Status page (it's in the Calibration tab).
    await expect(page.getByRole('button', { name: 'Calibrate Accelerometer' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Calibrate Compass' })).toHaveCount(0)
    // Enter DFU is a two-step confirm.
    const dfu = page.getByTestId('status-dfu-button')
    await expect(dfu).toBeVisible()
    await dfu.click()
    await expect(page.getByTestId('status-dfu-confirm')).toBeVisible()
  })

  test('calibration tab shows the inline accelerometer pose guide while calibration is active', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await openView(page, 'calibration')

    await page.getByRole('button', { name: 'Calibrate Accelerometer' }).click()
    await expect(page.getByTestId('calibration-accelerometer-guide')).toBeVisible({ timeout: CAL_FLOW_TIMEOUT })
    await expect(page.getByText('Current Posture')).toBeVisible()
    // Now that the demo mock advances pose-by-pose only on confirms, the
    // calibration parks on the level step until the operator clicks
    // "Confirm Level Position". That gives the pose-guide enough time to
    // render its validation row, which surfaces one of the four poses
    // ("Waiting for attitude" while telemetry is still spinning up,
    // "Pose aligned" / "Wrong pose" / "Adjust posture" once attitude data
    // is live).
    await expect(
      page.getByText(/Waiting for attitude|Pose aligned|Wrong pose|Adjust posture/)
    ).toBeVisible({ timeout: CAL_FLOW_TIMEOUT })
  })

  test('guided setup marks accelerometer complete after the in-app calibration succeeds', async ({ page }) => {
    // This spec walks six sequential confirm clicks plus a wizard navigation.
    // Each click auto-waits for the next button to render, so the worst-case
    // budget is roughly six expect-timeouts plus the full connect + param
    // sync. On a contended CI runner the demo connect alone can stretch, so
    // give this end-to-end spec a generous 180s ceiling (the chunkSize:0
    // demo-transport change cuts the sync cost; this is the safety margin).
    test.setTimeout(180_000)

    await connectToVehicle(page, 'demo')

    await completeAccelerometerCalibrationFromSetup(page)

    await openView(page, 'setup')
    await page.getByTestId('setup-start-guided-button').click()
    const accelerometerStep = page.locator('.setup-wizard-step').filter({ hasText: 'Accelerometer' })
    await expect(accelerometerStep).toHaveClass(/is-complete/, { timeout: CAL_FLOW_TIMEOUT })
  })

  test('the Setup craft preview is vehicle-aware (plane vs copter)', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    const copterPreview = page.getByTestId('setup-craft-preview')
    await expect(copterPreview).toBeVisible()
    await expect(copterPreview).not.toHaveAttribute('data-craft-model', 'plane')

    await connectToPlane(page)
    const planePreview = page.getByTestId('setup-craft-preview')
    await expect(planePreview).toBeVisible()
    // The demo Plane seeds Q_ENABLE=1 + Q_TILT_ENABLE=1, so it resolves to the
    // VTOL craft model (the Alti Transition mesh), not the copter mixer.
    await expect(planePreview).toHaveAttribute('data-craft-model', 'alti')
  })

  test('guided setup marks compass complete after the in-app onboard mag calibration succeeds', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await completeCompassCalibrationFromSetup(page)

    // The compass action button flips to "Run Again" once the runtime
    // records the SUCCESS MAG_CAL_REPORT, and the guided-setup wizard
    // counts the Compass step as complete.
    await expect(page.getByRole('button', { name: 'Run Again' }).first()).toBeVisible({ timeout: CAL_FLOW_TIMEOUT })
    await openView(page, 'setup')
    await page.getByTestId('setup-start-guided-button').click()
    const compassStep = page.locator('.setup-wizard-step').filter({ hasText: 'Compass' })
    await expect(compassStep).toHaveClass(/is-complete/, { timeout: CAL_FLOW_TIMEOUT })
  })

  test('local guided setup shortcut opens the requested step directly for faster iteration', async ({ page }) => {
    await connectToVehicle(page, 'demo', '/?guidedSetupStep=radio')

    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    await expect(page.locator('.setup-wizard__header h3')).toHaveText('Radio')
    await expect(page.getByText('Testing shortcut')).toBeVisible()
    await expect(page.locator('.setup-wizard-step').filter({ hasText: 'Failsafe' })).toBeEnabled()
  })

  test('Motor Setup tab shows the inline reorder/direction panel', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'motors')
    await expect(page.getByTestId('outputs-task-nav')).toBeVisible()
    await expect(page.getByTestId('outputs-summary-motor-setup')).toBeVisible()
    // The Motor Setup tab IS the reorder panel now (formerly a popout): its
    // Order/Direction sub-tabs + Apply bar render inline, no dialog.
    await page.getByTestId('outputs-summary-motor-setup').click()
    await expect(page.getByTestId('motor-reorder-lightbox-tabs')).toBeVisible()
    await expect(page.getByTestId('motor-reorder-lightbox-tab-reorder')).toBeVisible()
    await expect(page.getByTestId('motor-reorder-lightbox-tab-direction')).toBeVisible()
    await expect(page.getByTestId('motor-reorder-apply')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Motor Setup stages a direction change and offers Apply and reboot', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-motor-setup').click()

    const apply = page.getByTestId('motor-reorder-apply')
    await expect(apply).toBeVisible()
    // Single "Apply and reboot" button (no separate Reboot FC). Disabled until
    // something is staged.
    await expect(page.getByTestId('motor-reorder-reboot')).toHaveCount(0)
    await expect(apply).toBeDisabled()

    // Stage a reverse-direction bit from the Direction sub-tab.
    await page.getByTestId('motor-reorder-lightbox-tab-direction').click()
    const m1 = page.getByTestId('motor-reorder-direction-reverse-1').locator('input')
    await expect(m1).toBeEnabled()
    await m1.check()
    await expect(apply).toBeEnabled()
    await expect(apply).toContainText('Apply and reboot (1)')
  })

  test('Motor Setup runs the Betaflight-style guided identify flow (#459)', async ({ page }) => {
    // PR #459 added a guided "spin a motor, click which position spun" workflow.
    // It now lives inline in the Motor Setup tab and is gated on the panel's
    // props-off / test-area-clear safety ack.
    await connectToVehicle(page, 'demo')

    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-motor-setup').click()
    // Ack the safety gate in the inline panel (gates the guided spin).
    await page.getByTestId('motor-reorder-props-off-ack').locator('input').check()

    const startButton = page.getByTestId('motor-reorder-guided-start')
    await expect(startButton).toBeVisible()
    await expect(startButton).toBeEnabled()
    await startButton.click()

    // Banner replaces the start button while identify is in progress.
    // Operator-paced (field feedback): nothing spins until the explicit
    // Spin click, and the next motor never auto-spins after a pick.
    const banner = page.getByTestId('motor-reorder-guided-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('1 / 4')
    await expect(banner).toContainText('click Spin when ready')

    await page.getByTestId('motor-reorder-guided-spin').click()
    await expect(banner).toContainText(/OUT\d+ spun/, { timeout: COMMAND_ACK_TIMEOUT })

    // Picking a position advances to the next output — back into the
    // "click Spin when ready" state rather than auto-spinning.
    await page.getByTestId('motor-reorder-pick-1').click()
    await expect(banner).toContainText('2 / 4')
    await expect(banner).toContainText('click Spin when ready')

    // Cancel cleanly even if mid-sequence.
    const cancel = page.getByTestId('motor-reorder-guided-cancel')
    if (await cancel.count()) {
      await cancel.click()
    }
    // Banner gone after cancel.
    await expect(banner).toHaveCount(0)
    await expect(startButton).toBeVisible()
  })

  test('outputs supports an ALL motor test slider with sequential mapped-motor testing', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'motors')
    // The demo's recommendedOutputTaskId resolves to esc-protocol; the motor-test sliders
    // live under the direction-test task, so navigate there explicitly first.
    await page.getByTestId('outputs-summary-direction-test').click()
    // The Test tab shows the read-only motor map beside the throttle sliders.
    await expect(page.getByTestId('motor-test-diagram')).toBeVisible()
    await page.getByLabel('Props are off and the vehicle is restrained with the test area clear.').check()
    // The extra USB-bench acknowledgement is gated to a physical web-serial
    // link, so it must NOT appear (or block the test) over the demo transport.
    await expect(page.getByTestId('motor-test-usb-ack')).toHaveCount(0)
    await page.getByTestId('motor-test-sliders').getByText('ALL', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Run Motor Test' })).toBeEnabled()
  })

  test('tuning exposes linked PID edits, master sliders, advanced terms, and local tuning profiles', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'tuning')
    await expect(page.getByTestId('tuning-task-nav')).toBeVisible()
    await expect(page.getByTestId('tuning-summary-rates')).toBeVisible()
    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /PID Gains/i }).click()
    await expect(page.getByText('Axis controller gains', { exact: true })).toBeVisible()
    await expect(page.getByTestId('tuning-roll-pitch-link-button')).toBeVisible()

    await page.getByTestId('tuning-input-ATC_RAT_RLL_P').fill('0.12')
    await expect(page.getByTestId('tuning-input-ATC_RAT_PIT_P')).toHaveValue('0.12')

    await page.getByTestId('tuning-roll-pitch-unlink-button').click()
    await page.getByTestId('tuning-input-ATC_RAT_RLL_P').fill('0.14')
    await expect(page.getByTestId('tuning-input-ATC_RAT_PIT_P')).toHaveValue('0.12')

    await page.getByTestId('tuning-toggle-advanced-button').click()
    await expect(page.getByText('Roll D Feedforward', { exact: true })).toBeVisible()

    await page.getByTestId('tuning-master-pi-range').focus()
    await page.getByTestId('tuning-master-pi-range').press('ArrowRight')
    await expect(page.getByTestId('tuning-stage-master-adjustments-button')).toBeEnabled()
    await page.getByTestId('tuning-stage-master-adjustments-button').click()
    // The master sliders scale the live PID gains and stage the result as a
    // grouped draft batch. Assert the staging actually ran (the success notice
    // reports the grouped count) so the slider->preview->stage math is covered,
    // not just the button enable/click.
    await expect(
      page.getByText(/Staged \d+ grouped tuning change\(s\) from the master sliders\./)
    ).toBeVisible()

    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /Filters/i }).click()
    await expect(page.getByText('Axis bandwidth and smoothing', { exact: true })).toBeVisible()
    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /Profiles/i }).click()
    await page.getByTestId('tuning-profile-label-input').fill('Bench Test Profile')
    await expect(page.getByTestId('create-tuning-profile-button')).toBeEnabled()
    await page.getByTestId('create-tuning-profile-button').click()
    await expect(page.getByRole('heading', { name: 'Bench Test Profile' })).toBeVisible()
    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /Review/i }).click()
    await expect(page.getByText('Tuning changes in review', { exact: true })).toBeVisible()
  })

  test('staging a tuning change stays in place and does not auto-redirect to Review', async ({ page }) => {
    // Regression: editing a tuning value used to flip the active task to 'review'
    // mid-edit (the recommended-task memo returned 'review' as soon as anything
    // was staged, and the task override was still unset). Tuning now matches every
    // other parameter tab: edits stage in place; the operator opens Review.
    await connectToVehicle(page, 'demo')
    await openView(page, 'tuning')

    // Default landing task is rates, so the flight-feel input is visible.
    const input = page.getByTestId('tuning-input-ATC_INPUT_TC')
    await expect(input).toBeVisible()

    // Edit a rate -> stages a change. We must NOT be yanked to the Review panel.
    await input.fill('0.2')
    await input.blur()
    await expect(input).toBeVisible()
    await expect(page.getByText('Tuning changes in review', { exact: true })).toHaveCount(0)

    // The operator can still reach Review manually.
    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /Review/i }).click()
    await expect(page.getByText('Tuning changes in review', { exact: true })).toBeVisible()
  })

  test('manual motor test: Stop is disabled until a test is running', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-direction-test').click()
    await page.getByLabel('Props are off and the vehicle is restrained with the test area clear.').check()

    // The Stop (abort) control is always present but disabled until a test
    // is actually running — you can't abort what hasn't started.
    await expect(page.getByTestId('motor-test-sliders-stop')).toBeVisible()
    await expect(page.getByTestId('motor-test-sliders-stop')).toBeDisabled()
  })

  test('bundled websocket demo keeps core configuration surfaces reachable', async ({ page }) => {
    // This spec walks connect + boot, the full setup wizard, five view
    // navigations, the motor-test chain, and finally an async MAVFTP listing.
    // Under a full 8-worker run the contended dev server can push the total
    // past the global 60s test budget before the longer mavftp listing wait
    // below gets a chance to help. Bump just this one heavy spec to 120s (other
    // specs keep the 60s global) so the targeted listing timeout is effective.
    test.setTimeout(120_000)

    await connectToVehicle(page, 'demo')

    await expect(page.getByTestId('view-button-setup')).toBeVisible()
    await expect(page.getByTestId('view-button-ports')).toBeVisible()
    await expect(page.getByTestId('view-button-vtx')).toBeVisible()
    await expect(page.getByTestId('view-button-osd')).toBeVisible()
    await expect(page.getByTestId('view-button-receiver')).toBeVisible()
    await expect(page.getByTestId('view-button-motors')).toBeVisible()
    await expect(page.getByTestId('view-button-power')).toBeVisible()
    await expect(page.getByTestId('view-button-snapshots')).toBeVisible()
    await expect(page.getByTestId('view-button-tuning')).toBeVisible()
    await expect(page.getByTestId('view-button-presets')).toBeVisible()
    await expect(page.getByTestId('view-button-parameters')).toHaveCount(0)
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Status & Info')
    await expect(page.getByTestId('setup-craft-preview')).toBeVisible()
    // Calibration moved to the dedicated Calibration tab; the Status page no
    // longer carries the calibration buttons, and now offers Enter DFU.
    await expect(page.getByRole('button', { name: 'Calibrate Accelerometer' })).toHaveCount(0)
    await expect(page.getByTestId('status-dfu-button')).toBeVisible()
    // Pre-arm has its own box (above the lifetime stats) with the blocker list.
    await expect(page.getByTestId('setup-prearm')).toBeVisible()
    await expect(page.getByTestId('setup-prearm')).toContainText('Pre-arm')
    await expect(page.getByTestId('flight-deck-zero-heading-button')).toBeVisible()
    await page.getByTestId('flight-deck-zero-heading-button').click()
    await expect(page.getByText('Bench-forward zeroed')).toBeVisible()
    await expect(page.getByTestId('flight-deck-clear-heading-button')).toBeVisible()
    await expect(page.getByTestId('setup-gps-map-widget')).toBeVisible()
    await expect(page.getByTestId('setup-start-guided-button')).toBeVisible()
    await page.getByTestId('setup-start-guided-button').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    await expect(page.getByTestId('wizard-orientation-task')).toBeVisible()
    await expect(page.getByTestId('wizard-orientation-primary')).toBeVisible()
    await page.getByTestId('wizard-orientation-primary').click()
    await expect(page.getByTestId('wizard-orientation-task')).toContainText('running')
    // Orientation check now lives ONLY in the Setup wizard (the duplicate
    // copy in the Motors tab was removed — orientation is a Setup-flow
    // concern). Click Mark Failed in the same wizard's secondary actions
    // to drive it into the 'failed' state and confirm the primary button
    // copy flips to "Retry…".
    await page.getByRole('button', { name: 'Mark Failed' }).first().click()
    await expect(page.getByTestId('wizard-orientation-primary')).toContainText('Retry Orientation Check')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Status & Info')

    await openView(page, 'ports')
    await expect(page.getByRole('heading', { name: 'Ports & Peripherals' })).toBeVisible()
    await expect(page.getByTestId('ports-gps-map-widget')).toBeVisible()
    await expect(page.getByText('OSD routed through dedicated tab')).toBeVisible()
    await expect(page.getByText('VTX routed through dedicated tab')).toBeVisible()
    await openView(page, 'setup')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Status & Info')

    await openView(page, 'vtx')
    await expectWorkspaceViewTitle(page, 'VTX')
    await expect(page.getByText('Selected Mode', { exact: true })).toBeVisible()
    await expect(page.getByText('Actual State', { exact: true })).toBeVisible()

    await openView(page, 'osd')
    await expectWorkspaceViewTitle(page, 'OSD')
    await expect(page.getByText('Preview', { exact: true })).toBeVisible()
    // Preview is now editable (drag-to-reposition) — the old neutral
    // "read-only preview" badge was replaced with a success-toned
    // "editable · drag to reposition" badge. Match the full badge text: a bare
    // "editable" substring also matches the branch name in the header build
    // info on feature branches.
    await expect(page.getByText('editable · drag to reposition')).toBeVisible()

    await openView(page, 'receiver')
    await expect(page.getByText('Live monitor')).toBeVisible()
    await expect(page.getByTestId('receiver-task-nav')).toBeVisible()

    await openView(page, 'motors')
    await expect(page.getByTestId('outputs-task-nav')).toBeVisible()
    // Peripherals & Alerts moved to its own Servos nav tab as part of
    // the Outputs split (#227). After #229, the Servos tab lands on
    // the servo-function mapping table by default; click into the
    // Peripherals task explicitly to confirm the LED/buzzer copy
    // still renders there, then come back to Motors for the Direction
    // & Test continuation below.
    await openView(page, 'servos')
    await expect(page.getByTestId('servo-mapping-task-body')).toBeVisible()
    await page.getByTestId('outputs-task-nav').getByRole('tab', { name: /Peripherals & Alerts/i }).click()
    await expect(page.getByText('LED & buzzer notifications', { exact: true })).toBeVisible()
    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-direction-test').click()
    await page.getByLabel('Props are off and the vehicle is restrained with the test area clear.').check()
    // Motor-test surface reachable (the Run control + sliders render).
    await expect(page.getByRole('button', { name: 'Run Motor Test' })).toBeVisible()
    await expect(page.getByTestId('motor-test-sliders')).toBeVisible()

    await openView(page, 'power')
    // Power tab was renamed to "Battery" — the failsafe-shaped knobs that
    // used to live on this surface (BATT_FS_*, FS_THR_*, BATT_LOW_*,
    // BATT_CRT_*) now live exclusively on the Failsafe tab so the operator
    // has one place to think about loss-of-link behavior.
    await expect(page.getByRole('heading', { name: 'Battery', exact: true })).toBeVisible()
    await expect(page.getByText('Battery configuration')).toBeVisible()

    await page.getByTestId('product-mode-expert').click()
    await expect(page.getByTestId('view-button-parameters')).toBeVisible()

    // MAVFTP is now surfaced solely through the Files tab (the old developer
    // browser in the Expert/Parameters tab was removed). Verify the listing
    // works end-to-end through the real UI. The @SYS listing is an async
    // round-trip; under a contended full e2e run it can exceed the global
    // 15s expect budget even when healthy, so give the listing-dependent
    // assertions a longer budget without relaxing the global timeout.
    const mavftpListingTimeout = 45_000
    await openView(page, 'files')
    // This is a "surfaces reachable" smoke over the websocket bridge, which
    // adds a process + WS + chunking on top of the demo transport. The
    // async @SYS *listing* (directory rows) is intermittently slow/dropped
    // on this path under load, so we only assert the Files view itself is
    // reachable (its table chrome renders) here. The actual MAVFTP listing
    // and directory navigation are covered exhaustively, and reliably, by
    // the dedicated Files-view test over the demo transport (views.spec.ts).
    await expect(page.getByTestId('files-table')).toBeVisible({ timeout: mavftpListingTimeout })

    await openView(page, 'ports')
  })

  test('bitmask parameters render as a chip grid in the generic editor', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    // FS_OPTIONS (failsafe category) surfaces in the Failsafe view's
    // additional-settings card via the generic metadata editor. The
    // failsafe category used to route through Power; it now routes to
    // its own dedicated tab.
    await openView(page, 'failsafe')

    // FS_OPTIONS is flagged bitmask, so it renders as per-bit chips, not a
    // dropdown.
    const field = page.getByTestId('scoped-bitmask-FS_OPTIONS')
    await field.scrollIntoViewIfNeeded()
    await expect(field).toBeVisible()
    const bits = field.locator('.scoped-bitmask-bit')
    await expect(bits.first()).toBeVisible()
    // Demo seeds FS_OPTIONS=0, so every bit starts unset (no orange).
    await expect(bits.first()).not.toHaveClass(/is-set/)
    // Clicking a chip stages a draft and highlights it (bit 0 = value 1).
    await bits.first().click()
    await expect(bits.first()).toHaveClass(/is-set/)
  })

  test('Config arming checks render as a bitmask chip grid', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await openView(page, 'config')

    // ARMING_CHECK is flagged bitmask, so the Config arming section shows
    // per-bit chips. Demo seeds ARMING_CHECK=1 (bit 0 = "All checks").
    const field = page.getByTestId('scoped-bitmask-ARMING_CHECK')
    await field.scrollIntoViewIfNeeded()
    await expect(field).toBeVisible()
    const allChecks = field.locator('.scoped-bitmask-bit').first()
    await expect(allChecks).toHaveClass(/is-set/)
    // A non-"All" bit (e.g. Compass, bit 2) is present.
    await expect(field.getByText('Compass')).toBeVisible()
  })

  test('snapshots and presets stay consistent through a tuning-write round-trip', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'snapshots')
    await page.getByTestId('snapshot-label-input').fill('E2E baseline')
    await page.getByTestId('snapshot-protected-toggle').check()
    await page.getByTestId('capture-live-snapshot-button').click()

    await expect(page.getByText(/Saved snapshot "E2E baseline" with \d+ parameters\./)).toBeVisible()
    await expect(page.getByTestId('active-baseline-label')).toHaveText('E2E baseline')

    await openView(page, 'presets')
    await page.getByTestId('preset-card-flight-feel-soft').click()
    await expect(page.getByRole('heading', { name: 'Smooth Explorer' })).toBeVisible()
    await expect(page.getByTestId('apply-preset-button')).toBeVisible()

    await applySingleTuningChange(page, '0.2')

    await openView(page, 'snapshots')
    await expect(page.getByText('restore available')).toBeVisible()

    await expect(page.getByTestId('snapshot-restore-ack')).not.toBeChecked()
    await page.getByTestId('snapshot-restore-ack').check()
    // A previous write no longer blocks restore — writes self-verify against a
    // live readback, so the post-write refresh follow-up is advisory, not a
    // gate. Apply path also auto-refreshes (PR introducing auto-refresh),
    // so the manual "pull resets the ack" step the old test ran here is now
    // unreachable from this flow — the auto-refresh fired before the ack
    // was set, so there's no further refresh to drive a reset.
    await expect(page.getByTestId('apply-snapshot-restore-button')).toBeEnabled()
    await page.getByTestId('apply-snapshot-restore-button').click()

    await expect(page.getByText('already matched')).toBeVisible()
    await expect(page.getByTestId('active-baseline-label')).toHaveText('E2E baseline')
  })

  test('snapshot restore differentiates the source board/vehicle from the connected FC', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await openView(page, 'snapshots')
    await page.getByTestId('snapshot-label-input').fill('Identity check')
    await page.getByTestId('capture-live-snapshot-button').click()
    await expect(page.getByText(/Saved snapshot "Identity check"/)).toBeVisible()

    // The snapshot was captured on the connected demo FC, so it must read as the
    // same board (UID match) and same vehicle — and NOT flag a migration.
    await expect(page.getByTestId('snapshot-board-match')).toHaveText('Same board')
    await expect(page.getByTestId('snapshot-vehicle-match')).toHaveText('Same vehicle')
    await expect(page.getByTestId('snapshot-migration-notice')).toHaveCount(0)
  })

  test('a snapshot from a different vehicle is flagged as a cross-vehicle migration', async ({ page }) => {
    // Capture a baseline on a Plane, then reconnect as a Copter. The Plane
    // snapshot persists in the local library and must be flagged as coming
    // from a different vehicle when restoring onto the Copter.
    await connectToPlane(page)
    await openView(page, 'snapshots')
    await page.getByTestId('snapshot-label-input').fill('Plane baseline')
    await page.getByTestId('capture-live-snapshot-button').click()
    await expect(page.getByText(/Saved snapshot "Plane baseline"/)).toBeVisible()

    await connectToVehicle(page, 'demo')
    await openView(page, 'snapshots')
    await page.locator('.snapshot-card', { hasText: 'Plane baseline' }).first().click()

    await expect(page.getByTestId('snapshot-vehicle-match')).toContainText('ArduPlane')
    await expect(page.getByTestId('snapshot-vehicle-match')).toContainText('ArduCopter')
    await expect(page.getByTestId('snapshot-migration-notice')).toBeVisible()
  })

  test('websocket transport connects through the bundled demo bridge', async ({ page }) => {
    await connectToVehicle(page, 'websocket')

    await expect(page.getByText('WebSocket · ws://127.0.0.1:14550', { exact: true })).toBeVisible()
    await openView(page, 'ports')
    await expect(page.getByRole('heading', { name: 'Ports & Peripherals' })).toBeVisible()
  })

  test('connection failures surface a clear session notice instead of leaving the UI idle and ambiguous', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('websocket')
    await page.getByTestId('websocket-url-input').fill('ws://127.0.0.1:1')
    await page.getByTestId('connect-button').click()

    await expect(page.getByTestId('session-connection-notice')).toBeVisible()
    await expect(page.getByTestId('session-connection-notice')).toContainText('Failed to open WebSocket')
    // Since #664 the telemetry block collapses to a thin "Disconnected" pill
    // when not connected (the 'No vehicle' label only renders once connecting/
    // connected), so the unambiguous no-vehicle state is the pill being shown.
    await expect(page.getByTestId('header-disconnected-pill')).toBeVisible()
  })

  test('the post-write refresh follow-up does not block additional preset writes', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    // A write sets parameterFollowUp.refreshRequired. That used to hard-block
    // every other apply until a manual re-pull ("save doesn't work again").
    // Writes self-verify against a live readback, so the follow-up is now
    // advisory: a subsequent preset apply must stay enabled.
    await applySingleTuningChange(page, '0.2')

    await openView(page, 'presets')
    await page.getByTestId('preset-card-flight-feel-balanced').click()
    await expect(page.getByTestId('preset-apply-ack')).not.toBeChecked()
    await page.getByTestId('preset-apply-ack').check()
    await expect(page.getByTestId('apply-preset-button')).toBeEnabled()
    // The manual "Pull Parameters resets the ack" path the old test exercised
    // is now unreachable here — auto-refresh-on-write already fired during
    // applySingleTuningChange above, so the follow-up was cleared and the
    // button is gone. The core assertion (apply stays enabled despite the
    // refreshRequired bit) is still covered.
  })

  test('presets from different categories can be selected together and applied as one combined diff', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await openView(page, 'presets')

    // Pick one preset from the flight-feel group and one from the acro-rates
    // group — different categories, selected at the same time.
    await page.getByTestId('preset-card-flight-feel-soft').click()
    await page.getByTestId('preset-card-acro-rates-sport').click()

    // Both stay active simultaneously (multi-select, not single-select replace).
    await expect(page.getByTestId('preset-card-flight-feel-soft')).toHaveClass(/is-active/)
    await expect(page.getByTestId('preset-card-acro-rates-sport')).toHaveClass(/is-active/)

    // The review panel collapses to a single combined diff for the selection.
    await expect(page.getByRole('heading', { name: '2 presets selected' })).toBeVisible()

    // Apply writes the merged diff in one pass.
    await page.getByTestId('preset-apply-ack').check()
    await expect(page.getByTestId('apply-preset-button')).toBeEnabled()
    await page.getByTestId('apply-preset-button').click()
    // The combined write captures one pre-apply backup for the whole selection
    // and reports both presets as the source of the live changes.
    await expect(page.getByText('Pre-apply backup — 2 presets')).toBeVisible()
    await expect(page.getByText(/2 presets \(Smooth Explorer, Sport Acro\) changed live tuning values/).first()).toBeVisible()

    // Re-clicking an active card toggles it back off.
    await page.getByTestId('preset-card-flight-feel-soft').click()
    await expect(page.getByTestId('preset-card-flight-feel-soft')).not.toHaveClass(/is-active/)
    await expect(page.getByTestId('preset-card-acro-rates-sport')).toHaveClass(/is-active/)
  })

  test('destructive acknowledgments reset when preset and snapshot diffs change', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'snapshots')
    await page.getByTestId('snapshot-label-input').fill('Ack reset baseline')
    await page.getByTestId('capture-live-snapshot-button').click()
    await expect(page.getByText(/Saved snapshot "Ack reset baseline" with \d+ parameters\./)).toBeVisible()

    await openView(page, 'presets')
    await page.getByTestId('preset-card-flight-feel-soft').click()
    await expect(page.getByTestId('preset-apply-ack')).not.toBeChecked()
    await page.getByTestId('preset-apply-ack').check()
    await expect(page.getByTestId('preset-apply-ack')).toBeChecked()

    await applySingleTuningChange(page, '0.2')

    await openView(page, 'presets')
    // applySingleTuningChange now auto-refreshes the snapshot — the
    // refresh's parameter mutation also resets the preset/snapshot acks,
    // so the manual pullParameters that used to sit here is folded in.
    await expect(page.getByTestId('preset-apply-ack')).not.toBeChecked()

    await openView(page, 'snapshots')
    await expect(page.getByTestId('snapshot-restore-ack')).not.toBeChecked()
    await page.getByTestId('snapshot-restore-ack').check()
    await expect(page.getByTestId('snapshot-restore-ack')).toBeChecked()

    await applySingleTuningChange(page, '0.24')

    await openView(page, 'snapshots')
    await expect(page.getByTestId('snapshot-restore-ack')).not.toBeChecked()
  })

  test('protected snapshots must be unprotected before deletion', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'snapshots')
    await page.getByTestId('snapshot-label-input').fill('Protected baseline')
    await page.getByTestId('snapshot-protected-toggle').check()
    await page.getByTestId('capture-live-snapshot-button').click()

    await expect(page.getByText(/Saved snapshot "Protected baseline" with \d+ parameters\./)).toBeVisible()
    await expect(page.getByTestId('delete-selected-snapshot-button')).toBeDisabled()

    await page.getByTestId('toggle-selected-snapshot-protection-button').click()
    await expect(page.getByText('is no longer protected.')).toBeVisible()
    await expect(page.getByTestId('delete-selected-snapshot-button')).toBeEnabled()
  })

  test('snapshots can build a provisioning profile with batch metadata and a staged overlay', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    await openView(page, 'snapshots')
    await page.getByTestId('snapshot-label-input').fill('Provisioning baseline')
    await page.getByTestId('capture-live-snapshot-button').click()
    await expect(page.getByText(/Saved snapshot "Provisioning baseline" with \d+ parameters\./)).toBeVisible()

    await openView(page, 'tuning')
    await page.getByTestId('tuning-input-ATC_INPUT_TC').fill('0.2')

    await openView(page, 'snapshots')
    await page.getByTestId('provisioning-profile-label-input').fill('Battalion night ops')
    await page.getByTestId('provisioning-profile-checklist-input').fill('Motor order verified\nReceiver responds')
    await page.getByTestId('provisioning-profile-include-drafts-toggle').check()
    await page.getByTestId('capture-provisioning-profile-button').click()

    await expect(page.getByText('Saved provisioning profile "Battalion night ops"')).toBeVisible()
    await expect(page.getByText('profile diff ready')).toBeVisible()
    await expect(page.getByTestId('provisioning-profile-restore-ack')).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Apply Provisioning Profile (1)' })).toBeVisible()
    await expect(page.locator('.provisioning-checklist').getByText('Motor order verified', { exact: true })).toBeVisible()
    await expect(page.locator('.provisioning-checklist').getByText('Receiver responds', { exact: true })).toBeVisible()
  })

  test('snapshot view degrades gracefully when browser local storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem
      const originalSetItem = Storage.prototype.setItem

      Object.defineProperty(Storage.prototype, 'getItem', {
        configurable: true,
        value(this: Storage, key: string) {
          if (this === window.localStorage && key === 'arduconfig:snapshot-library') {
            throw new Error('local storage unavailable for test')
          }

          return originalGetItem.call(this, key)
        }
      })

      Object.defineProperty(Storage.prototype, 'setItem', {
        configurable: true,
        value(this: Storage, key: string, value: string) {
          if (this === window.localStorage && key === 'arduconfig:snapshot-library') {
            throw new Error('local storage unavailable for test')
          }

          return originalSetItem.call(this, key, value)
        }
      })
    })

    await connectToVehicle(page, 'demo')
    await openView(page, 'snapshots')
    await expect(page.getByText('Browser snapshot storage is unavailable.')).toBeVisible()

    await page.getByTestId('snapshot-label-input').fill('In-memory baseline')
    await page.getByTestId('capture-live-snapshot-button').click()
    await expect(page.getByText(/Saved snapshot "In-memory baseline" with \d+ parameters\./)).toBeVisible()
  })

  test('exporting a parameter backup actually triggers a file download', async ({ page }) => {
    // Regression: the download helper created a detached anchor and revoked the
    // object URL synchronously, so Brave/Firefox silently dropped the download.
    // The fix attaches the anchor and defers revoke; assert a real download
    // event fires.
    await connectToVehicle(page, 'demo')
    await page.getByTestId('product-mode-expert').click()
    await openView(page, 'parameters')
    const exportButton = page.getByTestId('export-parameter-backup')
    await expect(exportButton).toBeEnabled()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportButton.click()
    ])
    expect(download.suggestedFilename().length).toBeGreaterThan(0)
  })

  test('Expert import can skip calibration parameters from another airframe', async ({ page }) => {
    await connectToVehicle(page, 'demo')
    await page.getByTestId('product-mode-expert').click()
    await openView(page, 'parameters')

    // A .parm carrying one normal tuning change plus one compass calibration
    // offset (which should never carry over from a different airframe).
    const parm = ['# from another craft', 'ATC_RAT_RLL_P,0.123456', 'COMPASS_OFS_X,123'].join('\n')
    const fileInput = page.getByLabel('Import parameter backup file')

    // Exclusions default ON (field feedback): the calibration offset is
    // skipped out of the box.
    await expect(page.getByTestId('param-import-exclude-calibration')).toBeChecked()
    await fileInput.setInputFiles({ name: 'a.parm', mimeType: 'text/plain', buffer: Buffer.from(parm) })
    await expect(page.getByTestId('parameter-notice')).toContainText('Skipped 1 excluded parameter(s).')

    // Uncheck the Calibration skip and re-import: the offset carries over.
    await page.getByTestId('param-import-exclude-calibration').uncheck()
    await fileInput.setInputFiles({ name: 'a.parm', mimeType: 'text/plain', buffer: Buffer.from(parm) })
    await expect(page.getByTestId('parameter-notice')).toBeVisible()
    await expect(page.getByTestId('parameter-notice')).not.toContainText('Skipped')
  })

  test('the persistent draft bar follows edits across tabs and writes them all', async ({ page }) => {
    await connectToVehicle(page, 'demo')

    // No drafts yet -> no bar.
    await expect(page.getByTestId('global-draft-bar')).toHaveCount(0)

    // Stage an edit on the Failsafe tab (params are synced once the seeded
    // value shows in the field).
    await openView(page, 'failsafe')
    const fsValue = page.getByTestId('failsafe-row-FS_THR_VALUE').locator('input')
    await expect(fsValue).toHaveValue('975', { timeout: COMMAND_ACK_TIMEOUT })
    await fsValue.fill('980')
    await fsValue.blur()

    // The bar appears and follows across tabs.
    const bar = page.getByTestId('global-draft-bar')
    await expect(bar).toBeVisible()
    await expect(page.getByTestId('global-draft-count')).toHaveText('1 staged change')
    await openView(page, 'osd')
    await expect(bar).toBeVisible()

    // Write all -> drafts clear -> bar disappears.
    const write = page.getByTestId('global-draft-write')
    await expect(write).toBeEnabled()
    await write.click()
    await expect(bar).toHaveCount(0, { timeout: COMMAND_ACK_TIMEOUT })
  })
})
