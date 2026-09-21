import { expect, test, type Page } from '@playwright/test'

// The guided setup, walked end to end.
//
// This exists because the flow is the product's spine and had no spec of its
// own — coverage was scattered across app.spec/views.spec, and the step gating
// is coupled to state that OTHER tabs set. That coupling has bitten before: a
// step silently stopped being satisfiable when the UI feeding its criteria
// changed, and nothing failed. These assertions are deliberately about the
// SHAPE of the flow (every step reachable, gated, actionable, and laid out)
// rather than any one step's contents, so an Outputs or Power refactor that
// breaks the wizard shows up here.
//
// Locked steps are reached with ?guidedSetupStep=<id>, the app's own
// localhost-only testing shortcut — not a seam added for this file.

const VEHICLE_CONNECT_TIMEOUT = 30_000

/** Every section the ArduCopter metadata defines, in flow order. */
const SECTIONS = [
  'link', 'ports', 'airframe', 'outputs', 'accelerometer',
  // Power moved ahead of Failsafe deliberately: the failsafe review wants live
  // battery telemetry, and BATT_MONITOR -- the thing that produces it -- is
  // configured in Power. With Power last, the step that fixed the problem sat
  // behind the step blocked by it, and the wizard could not be completed on a
  // bench board with no pack attached.
  'level', 'compass', 'radio', 'modes', 'power', 'failsafe'
] as const

async function openGuidedSetup(page: Page, shortcutSection?: string): Promise<void> {
  await page.goto(shortcutSection ? `/?guidedSetupStep=${shortcutSection}` : '/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  await page.getByTestId('view-button-guided-setup').click()
  await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
}

test.describe('Guided setup flow', () => {
  test('every metadata section appears as a step, in order', async ({ page }) => {
    // A section the metadata defines but the wizard never renders is invisible
    // in every other test: the flow simply skips it and still looks healthy.
    await openGuidedSetup(page)
    const steps = page.locator('.setup-wizard-step')
    await expect(steps).toHaveCount(SECTIONS.length)
    for (const [index, id] of SECTIONS.entries()) {
      await expect(page.getByTestId(`setup-step-${id}`)).toBeVisible()
      await expect(steps.nth(index)).toHaveAttribute('data-testid', `setup-step-${id}`)
    }
  })

  test('the sequence gates: exactly one current step, nothing open past it', async ({ page }) => {
    // The core safety property. If locking breaks, an operator can jump to
    // motor testing before the frame is confirmed.
    await openGuidedSetup(page)
    const current = page.locator('[data-step-state="current"]')
    await expect(current).toHaveCount(1)

    const states: string[] = []
    for (const id of SECTIONS) {
      states.push((await page.getByTestId(`setup-step-${id}`).getAttribute('data-step-state')) ?? '?')
    }
    // Once locked, every later step must stay locked — no gaps.
    const firstLocked = states.indexOf('locked')
    if (firstLocked >= 0) {
      for (const state of states.slice(firstLocked)) {
        expect(state, `states were ${states.join(',')}`).toBe('locked')
      }
    }
    // And a locked step cannot be clicked into.
    const lockedId = SECTIONS[firstLocked]
    if (lockedId) await expect(page.getByTestId(`setup-step-${lockedId}`)).toBeDisabled()
  })

  for (const id of SECTIONS) {
    test(`step "${id}" renders content, actions and criteria without overflowing`, async ({ page }) => {
      await openGuidedSetup(page, id)
      const body = page.locator('.setup-wizard__body')
      await expect(body).toBeVisible()

      // Substantive content, not an empty shell. A step that renders nothing
      // still "passes" a smoke test that only checks the wizard is visible.
      const text = ((await body.textContent()) ?? '').replace(/\s+/g, ' ').trim()
      expect(text.length, `step ${id} rendered almost nothing`).toBeGreaterThan(60)

      // Something to DO and something to judge it by — a step with neither is
      // a dead end the operator cannot leave.
      expect(await body.locator('button:visible').count(), `step ${id} has no actions`).toBeGreaterThan(0)
      expect(await body.locator('li').count(), `step ${id} has no criteria`).toBeGreaterThan(0)

      // Laid out at both widths. The bench is a laptop, but the app is held to
      // 390px everywhere else and the wizard is no exception.
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        expect(overflow, `step ${id} overflows at ${width}px`).toBeLessThanOrEqual(2)
      }
    })
  }

  // Where each step's "Open ..." excursion is supposed to land. This is the
  // coupling that breaks silently when a surface moves: the wizard routes by
  // panel id, the panel id maps to a view, and if that view stopped existing —
  // or the panel now lives inside a Config CATEGORY that is not the active one
  // — the operator lands somewhere blank with nothing failing. Flight modes and
  // Power have both moved into Config; that is exactly how this was found.
  const PANEL_DESTINATIONS: Array<{ section: string; panelId: string }> = [
    { section: 'ports', panelId: 'setup-panel-ports' },
    { section: 'outputs', panelId: 'setup-panel-outputs' },
    { section: 'radio', panelId: 'setup-panel-rc' },
    { section: 'modes', panelId: 'setup-panel-modes' },
    { section: 'power', panelId: 'setup-panel-power' },
    { section: 'failsafe', panelId: 'setup-panel-failsafe' }
  ]

  for (const { section, panelId } of PANEL_DESTINATIONS) {
    test(`step "${section}" lands on a real panel, not an empty view`, async ({ page }) => {
      await openGuidedSetup(page, section)
      const open = page.locator('.setup-wizard__body button:visible', { hasText: /^Open / }).first()
      await expect(open, `step ${section} offers no "Open ..." action`).toBeVisible()
      await open.click()

      // The panel itself is on screen — not merely the right tab.
      await expect(page.locator(`#${panelId}`)).toBeVisible({ timeout: 15_000 })
      // ...and the nav shows where we are, so the operator is not lost.
      await expect(page.locator('.workspace-nav__item--tab.is-active')).toHaveCount(1)
      // ...with a way back that names the step.
      await expect(page.getByTestId('setup-return-to-wizard')).toBeVisible()
    })
  }

  test('"Already Calibrated — Continue" actually lets you continue', async ({ page }) => {
    // Found by walking the flow: the level step's waiver recorded an
    // 'already-done' confirmation that satisfied only its "recorded"
    // criterion, leaving "completed successfully" pending forever — so the
    // step could not complete. Its Clear button is disabled unless the in-app
    // calibration succeeded, so the waiver could not be undone either. A
    // button promising continuation that stranded you, with its own undo
    // greyed out. Accelerometer and compass had always collapsed to a single
    // met criterion here; level was the one that did not.
    await openGuidedSetup(page, 'level')
    const step = page.getByTestId('setup-step-level')

    await page.getByRole('button', { name: /Already Calibrated — Continue/i }).click()

    // The step completes...
    await expect(step).toHaveAttribute('data-step-state', 'complete')
    // ...the flow moves on...
    await expect(page.getByRole('button', { name: /Continue to Compass Calibration/i })).toBeEnabled()
    // ...and the waiver is undoable, which is what made this a trap rather
    // than an inconvenience.
    await expect(page.getByRole('button', { name: /Clear External Level Confirmation/i })).toBeEnabled()
    // The in-app calibration stays available as the other way out.
    await expect(page.getByRole('button', { name: /Run Level Calibration Instead/i })).toBeVisible()
  })

  test('a non-Copter vehicle can actually sign off its generic steps', async ({ page }) => {
    // Plane, Rover and Sub declare section ids the Copter switch does not name
    // ('sensors', 'verify', 'drive', 'frame', 'controls'), and those steps are
    // completed by an operator sign-off. confirmSetupSection used to return
    // SILENTLY unless the section had a signature — and signatures are defined
    // only for the Copter ids. So the button did nothing: no record, no
    // criterion met, no error, and the sequential lock stranded everything
    // behind it. A Plane could not get past step 3 of 8.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })

    // Reach the first generic step the way the flow does.
    await page.getByRole('button', { name: /Continue to Airframe/i }).click()
    await page.getByRole('button', { name: /Orientation Verified Elsewhere/i }).click()
    await page.getByRole('button', { name: /Continue to Sensors/i }).click()

    const sensors = page.getByTestId('setup-step-sensors')
    await expect(sensors).toHaveAttribute('data-step-state', 'current')
    await page.getByRole('button', { name: /Confirm Sensors Review/i }).click()

    // The sign-off sticks: criterion met, step complete, next step reachable.
    await expect(sensors).toHaveAttribute('data-step-state', 'complete')
    await expect(page.getByRole('button', { name: /Continue to Radio/i })).toBeEnabled()
    // ...and it is undoable, like every other confirmed step.
    await expect(page.getByRole('button', { name: /Clear Sensors Review/i })).toBeVisible()
  })

  test('the RTL-altitude check follows the vehicle, or is not asked at all', async ({ page }) => {
    // The criterion read RTL_ALT / RTL_ALT_M, which only ArduCopter has.
    // Plane's return altitude is RTL_ALTITUDE (metres, default 100 per
    // ArduPlane/config.h ALT_HOLD_HOME); Rover and Sub have none at all — a
    // rover's failsafe does not fly home. So on every non-Copter vehicle this
    // criterion was permanently false, which blocked the failsafe step and
    // everything behind it.
    const criteriaOf = async () =>
      (await page.locator('.setup-wizard__body li').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())

    // Copter: asked, and failing on the firmware default of 15 m — which is
    // the entire point of the check.
    await openGuidedSetup(page, 'failsafe')
    let criteria = await criteriaOf()
    expect(criteria.some((c) => /RTL return altitude/i.test(c))).toBe(true)
    expect(criteria.some((c) => /Pending.*RTL return altitude/i.test(c))).toBe(true)

    // Copter with it raised: satisfied.
    await page.goto('/?guidedSetupStep=failsafe&demoParamOverrides=RTL_ALT:3000')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
    criteria = await criteriaOf()
    expect(criteria.some((c) => /Complete.*RTL return altitude/i.test(c))).toBe(true)

    // Plane: asked, and satisfied from ITS parameter (RTL_ALTITUDE = 100 m).
    await page.goto('/?guidedSetupStep=failsafe')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
    criteria = await criteriaOf()
    expect(criteria.some((c) => /Complete.*RTL return altitude/i.test(c))).toBe(true)

    // Rover: not asked at all. A rover's failsafe does not fly home, and
    // asserting an altitude it never reports blocked the step outright.
    await page.goto('/?guidedSetupStep=failsafe')
    await page.evaluate(() => window.localStorage.setItem('arduconfig:transport-mode', 'demo-rover'))
    await page.reload()
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
    criteria = await criteriaOf()
    expect(criteria.length).toBeGreaterThan(0)
    expect(criteria.some((c) => /RTL return altitude/i.test(c))).toBe(false)
  })

  test('a whole vehicle can be taken from step one to every step complete', async ({ page }) => {
    // The assertion the rest of this file could not make: not that each step
    // renders, but that the flow can be FINISHED. A Rover, because it is the
    // shortest flow and — until the sign-off fix — could not get past step 2
    // of 7. It needs no bench exercises, so it can be walked headlessly.
    test.setTimeout(180_000)
    await page.goto('/')
    await page.evaluate(() => window.localStorage.setItem('arduconfig:transport-mode', 'demo-rover'))
    await page.reload()
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })

    // Walk the way an operator does: move on when allowed, else take the
    // documented waiver (a bench cannot pass the motion exercises), else sign
    // the step off.
    //
    // Each hop POLLS for a usable button instead of sampling once: several
    // criteria track live vehicle state — the power step's "pre-arm checks
    // passing" flickers with the FC's own reporting — so a single look can
    // catch a step mid-blink and call a healthy flow stuck.
    const clickForward = async (): Promise<boolean> => {
      const patterns = [/Continue to /i, /Verified Elsewhere|Already Calibrated/i, /Confirm /i]
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        for (const pattern of patterns) {
          const buttons = page.locator('.setup-wizard button:visible', { hasText: pattern })
          for (let i = 0; i < (await buttons.count()); i += 1) {
            if (await buttons.nth(i).isEnabled()) {
              await buttons.nth(i).click()
              return true
            }
          }
        }
        await page.waitForTimeout(500)
      }
      return false
    }

    for (let hop = 0; hop < 30; hop += 1) {
      if (!(await clickForward())) break
      await page.waitForTimeout(300)
    }

    // Every step, green. Reported per step so a failure names which one stuck.
    const states = await page
      .locator('.setup-wizard-step')
      .evaluateAll((els) =>
        els.map((el) => `${(el.getAttribute('data-testid') ?? '').replace('setup-step-', '')}=${el.getAttribute('data-step-state')}`)
      )
    expect(states.length).toBeGreaterThan(4)
    expect(states.filter((state) => !state.endsWith('=complete'))).toEqual([])
  })

  test('the first step offers no way backwards, the last no way onwards', async ({ page }) => {
    // Both ends are where a wizard usually breaks: a Previous that leaves the
    // flow, or a Continue past the end.
    await openGuidedSetup(page, 'link')
    await expect(page.getByRole('button', { name: /Previous Step/i })).toBeDisabled()

    // The last step is whatever SECTIONS says it is, so this keeps testing "the
    // end of the flow" rather than one hardcoded step id.
    await openGuidedSetup(page, SECTIONS[SECTIONS.length - 1])
    // Setup Complete stays gated until the step's own confirmation is given.
    await expect(page.getByRole('button', { name: /Setup Complete/i })).toBeDisabled()
  })

  test('leaving for a panel offers a way back that names the step', async ({ page }) => {
    // The flow sends operators to other tabs to do the actual work. Before the
    // return bar existed they had to find their way back through the nav and
    // hope they landed on the right step.
    await openGuidedSetup(page, 'outputs')
    await page.getByRole('button', { name: /^Open Motors$/ }).click()
    await expect(page.getByTestId('setup-wizard')).toBeHidden()

    const back = page.getByTestId('setup-return-to-wizard')
    await expect(back).toBeVisible()
    await expect(back).toContainText('Outputs')
    await back.click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    // And it returns to the step you left, not to the top of the flow.
    await expect(page.getByTestId('setup-step-outputs')).toHaveClass(/is-active/)
  })

  test('walking the flow logs no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 200))
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 200)}`))

    await openGuidedSetup(page)
    for (const id of ['link', 'ports', 'airframe']) {
      await page.getByTestId(`setup-step-${id}`).click()
      await expect(page.getByTestId('setup-wizard')).toBeVisible()
    }
    expect(errors, `console errors while walking the flow:\n${errors.join('\n')}`).toEqual([])
  })
})
