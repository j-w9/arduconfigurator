import { expect, test, type Page } from '@playwright/test'
import { worstViewportOverflow } from './support/overflow'

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
  // Motor Range follows Radio (the ESC calibration uses the stick's maximum
  // and the spin wizard runs after it); Ready to Fly is the last look before
  // props go on.
  'level', 'compass', 'radio', 'motor-range', 'initial-tune', 'modes', 'power', 'failsafe', 'readiness',
  // The first flight, read from its log; waivable as flown elsewhere. Then
  // the hover-throttle flight.
  'maiden', 'hover', 'filters', 'autotune'
] as const

// Guided Setup is Expert-only while it is reworked, so every test here starts
// in Expert mode (product mode is read from sessionStorage at load).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
})

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
    // Past the current step nothing is OPEN: a later step is locked, or it is
    // already satisfied (a compass calibrated on the vehicle reads complete
    // wherever it sits) -- never a second current step.
    const firstLocked = states.indexOf('locked')
    if (firstLocked >= 0) {
      for (const state of states.slice(firstLocked)) {
        expect(['locked', 'complete'], `states were ${states.join(',')}`).toContain(state)
      }
    }
    // A locked step opens as a preview: you can look, every action is off.
    const lockedId = SECTIONS[firstLocked]
    if (lockedId) {
      await page.getByTestId(`setup-step-${lockedId}`).click()
      await expect(page.getByTestId(`setup-step-${lockedId}`)).toHaveClass(/is-active/)
      await expect(page.getByTestId('setup-wizard-preview')).toBeVisible()
      // Under the testing shortcut the step is live; without it the hero is
      // off and only the Open … jumps work. This run uses no shortcut.
      const hero = page.getByTestId('setup-wizard-primary-action')
      if ((await hero.count()) > 0) await expect(hero).toBeDisabled()
      await expect(page.locator('[data-step-state="current"]')).toHaveCount(1)
    }
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
        const overflow = (await worstViewportOverflow(page)).worst
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
    // 'link' is deliberately absent until the return bar survives the Status &
    // Info detour (the setup-view mode sync hides it there today).
    { section: 'airframe', panelId: 'setup-panel-airframe' },
    { section: 'ports', panelId: 'setup-panel-ports' },
    { section: 'outputs', panelId: 'setup-panel-outputs' },
    { section: 'motor-range', panelId: 'setup-panel-outputs' },
    { section: 'radio', panelId: 'setup-panel-rc' },
    { section: 'modes', panelId: 'receiver-section-flight-modes' },
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
      const back = page.getByTestId('setup-return-to-wizard')
      await expect(back).toBeVisible()
      // ...that is actually on screen. toBeVisible passes for an element
      // scrolled out of view, and that is exactly how the bar failed: the deep
      // link scrolls the destination panel to just under the app header, and a
      // static bar at the top of the column went with everything above it.
      // The scroll is smooth, so poll until it settles.
      const viewportHeight = page.viewportSize()?.height ?? 720
      await expect
        .poll(async () => {
          const box = await back.boundingBox()
          return box !== null && box.y >= 0 && box.y + box.height <= viewportHeight
        }, { message: `the return bar is off-screen after opening ${panelId}` })
        .toBe(true)
    })
  }

  test('step 1\'s "Open Vehicle Link" is a detour with a way back, like every other excursion', async ({ page }) => {
    // Vehicle Link lives on Status & Info, and Status & Info is also where the
    // flow ENDS -- the tab sync set the flow inactive the moment that tab was
    // open. So the one excursion that step 1 offers dropped the operator on
    // Status & Info with no return bar, while every other step's "Open ..." kept
    // one. Now scrollToPanel marks it a detour.
    await openGuidedSetup(page, 'link')
    await page.getByRole('button', { name: /^Open Vehicle Link$/ }).click()
    await expect(page.locator('#setup-panel-link')).toBeVisible({ timeout: 15_000 })
    const back = page.getByTestId('setup-return-to-wizard')
    await expect(back).toBeVisible()
    await expect(back).toContainText('Vehicle Link')
    await back.click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    await expect(page.getByTestId('setup-step-link')).toHaveClass(/is-active/)

    // Leaving for Status & Info by the NAV still ends the flow: no bar there.
    await page.getByTestId('view-button-setup').click()
    await expect(page.getByTestId('setup-return-to-wizard')).toHaveCount(0)
  })

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

  test('clearing the only sign-off survives a reload', async ({ page }) => {
    // Progress is durable (localStorage, keyed by board). The save effect
    // skipped the write when there was nothing to save -- so revoking the ONLY
    // confirmation never reached storage, and a reload brought the cleared
    // step straight back as complete.
    await openGuidedSetup(page, 'level')
    const step = page.getByTestId('setup-step-level')
    await page.getByRole('button', { name: /Already Calibrated — Continue/i }).click()
    await expect(step).toHaveAttribute('data-step-state', 'complete')
    await page.getByRole('button', { name: /Clear External Level Confirmation/i }).click()
    await expect(step).not.toHaveAttribute('data-step-state', 'complete')

    await openGuidedSetup(page, 'level')
    await expect(page.getByTestId('setup-step-level')).not.toHaveAttribute('data-step-state', 'complete')
    // And the positive case still holds: a sign-off that is NOT cleared comes
    // back, so this is not passing because persistence is broken altogether.
    await page.getByRole('button', { name: /Already Calibrated — Continue/i }).click()
    await expect(page.getByTestId('setup-step-level')).toHaveAttribute('data-step-state', 'complete')
    await openGuidedSetup(page, 'level')
    await expect(page.getByTestId('setup-step-level')).toHaveAttribute('data-step-state', 'complete')
  })

  test('sign-offs do not follow a board that is re-flashed to another vehicle type', async ({ page }) => {
    // Durable progress was keyed by the board uid alone. The uid names the
    // BOARD, and one board is routinely re-flashed between vehicle types, so a
    // Rover's sign-offs came back on the Plane that board became. The generic
    // steps ('sensors', 'verify', ...) have no parameter signature that could
    // catch it, so those sign-offs were held for good. Every demo vehicle
    // reports the same board uid, which is exactly the re-flash case.
    test.setTimeout(120_000)
    await page.goto('/')
    await page.evaluate(() => window.localStorage.setItem('arduconfig:transport-mode', 'demo-rover'))
    await page.reload()
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
    // Rover: the wizard opens on Sensors, the step to do (link is complete on
    // connect). Sign the generic step off.
    await expect(page.getByTestId('setup-step-sensors')).toHaveAttribute('data-step-state', 'current')
    await page.getByRole('button', { name: /Confirm Sensors Review/i }).click()
    await expect(page.getByTestId('setup-step-sensors')).toHaveAttribute('data-step-state', 'complete')

    // Same board, now a Plane.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
    // Plane also has a 'sensors' step. It must NOT inherit the Rover's sign-off
    // -- nor may anything but the link step be complete on a fresh Plane.
    await expect(page.getByTestId('setup-step-sensors')).not.toHaveAttribute('data-step-state', 'complete')
    const states = await page
      .locator('.setup-wizard-step')
      .evaluateAll((els) =>
        els
          .filter((el) => el.getAttribute('data-step-state') === 'complete')
          .map((el) => (el.getAttribute('data-testid') ?? '').replace('setup-step-', ''))
      )
    expect(states).toEqual(['link'])
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

    // Reach the first generic step the way the flow does. The wizard opens on
    // the step to do -- Airframe, since Vehicle Link completes on connect.
    await expect(page.getByTestId('setup-step-airframe')).toHaveAttribute('data-step-state', 'current')
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
    expect(criteria.some((c) => /Return altitude/i.test(c))).toBe(true)
    expect(criteria.some((c) => /Pending.*Return altitude/i.test(c))).toBe(true)

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
    expect(criteria.some((c) => /Complete.*Return altitude/i.test(c))).toBe(true)

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
    expect(criteria.some((c) => /Complete.*Return altitude/i.test(c))).toBe(true)

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
    expect(criteria.some((c) => /Return altitude/i.test(c))).toBe(false)
  })

  // The assertion the rest of this file could not make: not that each step
  // renders, but that the flow can be FINISHED. Rover first (the shortest flow;
  // until the sign-off fix it could not get past step 2 of 7), then Sub and
  // Plane: the Sub demo now carries the firmware's FS_THR_ENABLE=0 default,
  // which deadlocked the Copter-shaped failsafe step, and the Plane demo no
  // longer carries the Copter params a real Plane lacks. None of the three
  // needs a bench exercise, so they can be walked headlessly. The Copter
  // ('demo') walks too: every motion exercise has its documented waiver, and
  // Ready to Fly wants a saved snapshot, which the walk captures first -- the
  // way an operator would.
  for (const demo of ['demo', 'demo-rover', 'demo-sub', 'demo-plane'] as const) {
  test(`a whole vehicle can be taken from step one to every step complete (${demo})`, async ({ page }) => {
    test.setTimeout(180_000)
    // The Copter demo carries ArduPilot's 15 m RTL default, which the Failsafe
    // step refuses on purpose (below the treeline); an operator raises it on
    // the Failsafe tab, the walk starts with it raised.
    await page.goto(demo === 'demo' ? '/?demoParamOverrides=RTL_ALT:3000' : '/')
    await page.evaluate((mode) => window.localStorage.setItem('arduconfig:transport-mode', mode), demo)
    await page.reload()
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    if (demo === 'demo') {
      await page.getByTestId('view-button-snapshots').click()
      await page.getByTestId('capture-live-snapshot-button').click()
      await expect(page.locator('#setup-panel-snapshots')).toContainText(/Live snapshot|snapshot/i)
    }
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
      const patterns = [/Continue to /i, /Verified Elsewhere|Already Calibrated|Measured Elsewhere|Flown Elsewhere|Set Elsewhere|Tuned Elsewhere/i, /Acknowledge/i, /Confirm /i]
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        // Support actions past the second fold behind "More…"; a waiver can
        // be in there.
        const more = page.getByTestId('setup-wizard-more')
        if ((await more.count()) > 0 && !(await more.evaluate((el) => (el as HTMLDetailsElement).open))) {
          await more.locator('summary').click()
        }
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

    // Sixteen steps, most of them a waiver or confirm plus a Continue: well
    // over thirty clicks on the Copter.
    for (let hop = 0; hop < 80; hop += 1) {
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

    // And the last step now says so. After the final sign-off the step's only
    // remaining action was its Clear, and the any-action fallback made that
    // the hero: "→ Clear Verify Review" as the thing to do next, and a disabled
    // "Setup Complete" beside it. Now: a completion card, the way out as the
    // hero, and the undo still offered -- as a plain support action.
    const finished = page.getByTestId('setup-wizard-finished')
    await expect(finished).toBeVisible()
    // ...and says what happens next, in words.
    await expect(finished).toContainText('Setup on the bench is done')
    await expect(finished).toContainText('first flight')
    await expect(page.getByTestId('setup-wizard-primary-action')).toHaveCount(0)
    // The undo is a pinned support action: in view, never folded.
    await expect(page.locator('.setup-wizard__action-card > .setup-wizard__support-actions button', { hasText: /^Clear / })).toBeVisible()
    await expect(page.getByTestId('setup-wizard-finish')).toHaveText(/Back to Status & Info/)
    // The hero hands over to the first flight.
    const calibration = page.getByTestId('setup-wizard-finish-calibration')
    await expect(calibration).toHaveText(/Calibration/)
    await calibration.click()
    // Calibration is a Setup category now.
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Setup')
    await expect(page.getByTestId('config-category-calibration')).toHaveAttribute('aria-selected', 'true')
    // The flow is over, so no return bar follows the operator there.
    await expect(page.getByTestId('setup-return-to-wizard')).toHaveCount(0)
  })
  }

  test('the aside shows one hero and at most two support actions; the rest fold, the undo never does', async ({ page }) => {
    // The aside has to fit one desktop screen. Radio carries five support
    // actions (waivers, re-runs, the mapping exercise) -- three fold behind
    // "More…", all still one click away.
    await openGuidedSetup(page, 'radio')
    const inView = page.locator('.setup-wizard__action-card > .setup-wizard__support-actions button')
    expect(await inView.count()).toBeLessThanOrEqual(2)
    const more = page.getByTestId('setup-wizard-more')
    await expect(more).toBeVisible()
    await expect(more.locator('summary')).toHaveText('More…')
    expect(await more.locator('button').count()).toBeGreaterThan(0)
    await more.locator('summary').click()
    await expect(more.locator('button').first()).toBeVisible()
    // Total support actions are unchanged -- folding hides nothing for good.
    expect((await inView.count()) + (await more.locator('button').count())).toBeGreaterThan(2)

    // A recorded waiver's undo is pinned: it shows outside the fold.
    await openGuidedSetup(page, 'level')
    await page.getByRole('button', { name: /Already Calibrated — Continue/i }).click()
    await expect(page.locator('.setup-wizard__action-card > .setup-wizard__support-actions button', { hasText: /^Clear / })).toBeVisible()
  })

  test('Ready to Fly sends the operator to Arming checks, Snapshots and back', async ({ page }) => {
    // The last step's jumps land inside Config (a category that only exists
    // in the DOM while active) and on the Snapshots page, which had no anchor.
    await openGuidedSetup(page, 'readiness')
    await page.getByRole('button', { name: /^Open Arming Checks$/ }).click()
    await expect(page.getByTestId('config-section-arming')).toBeVisible({ timeout: 15_000 })
    const back = page.getByTestId('setup-return-to-wizard')
    await expect(back).toContainText('Ready to Fly')
    await back.click()
    await expect(page.getByTestId('setup-step-readiness')).toHaveClass(/is-active/)
    // No snapshot in a fresh demo, so the step offers Snapshots.
    await page.getByRole('button', { name: /^Open Snapshots$/ }).click()
    await expect(page.locator('#setup-panel-snapshots')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('setup-return-to-wizard')).toBeVisible()
  })

  test('no step is a dead end: a hard criterion can be overridden, loudly and undoably', async ({ page }) => {
    // ARMING_CHECK=0 is refused by Ready to Fly with no waiver on purpose.
    // The operator can still override -- and the step says so everywhere.
    await openGuidedSetup(page, 'readiness&demoParamOverrides=ARMING_CHECK:0')
    const step = page.getByTestId('setup-step-readiness')
    await expect(page.getByRole('button', { name: /^Confirm Ready to Fly$/ })).toBeDisabled()
    const more = page.getByTestId('setup-wizard-more')
    if ((await more.count()) > 0 && !(await more.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await more.locator('summary').click()
    }
    await page.getByRole('button', { name: /Override — Continue Anyway/ }).click()
    await expect(step).toHaveAttribute('data-step-state', 'complete')
    await expect(page.locator('.setup-wizard')).toContainText('Overridden')
    await expect(page.locator('.setup-wizard')).toContainText('(overridden)')
    const clear = page.getByRole('button', { name: /^Clear Override$/ })
    await expect(clear).toBeEnabled()
    await clear.click()
    await expect(step).not.toHaveAttribute('data-step-state', 'complete')
  })

  test('a Plane is not offered the Copter motor test', async ({ page }) => {
    // The motor test translates motor numbers through FRAME_CLASS/FRAME_TYPE,
    // which a QuadPlane does not have (its matrix is Q_FRAME_*): on Plane it
    // spun the wrong motor. The Outputs step sends a Plane to Servos instead.
    await page.goto('/?guidedSetupStep=outputs')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('setup-step-outputs')).toHaveClass(/is-active/)
    await expect(page.getByTestId('wizard-motor-task')).toHaveCount(0)
    await expect(page.locator('.setup-wizard button:visible', { hasText: /Start Motor Verification/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Open Servos$/ })).toBeVisible()
  })

  test('the first step offers no way backwards, the last no way onwards', async ({ page }) => {
    // Both ends are where a wizard usually breaks: a Previous that leaves the
    // flow, or a Continue past the end.
    await openGuidedSetup(page, 'link')
    await expect(page.getByRole('button', { name: /Previous Step/i })).toBeDisabled()

    // The last step is whatever SECTIONS says it is, so this keeps testing "the
    // end of the flow" rather than one hardcoded step id.
    await openGuidedSetup(page, SECTIONS[SECTIONS.length - 1])
    // The end stays gated until the step's own confirmation is given -- and the
    // disabled button says what is wanted, not "Setup Complete" on a step that
    // is not.
    const finish = page.getByRole('button', { name: /Confirm to finish/i })
    await expect(finish).toBeDisabled()
    await expect(page.getByRole('button', { name: /Setup Complete/i })).toHaveCount(0)

    // A disabled wizard button LOOKS disabled. The buttons are styled inline,
    // which set cursor: pointer and nothing for :disabled, so a locked
    // Continue was pixel-identical to a live one.
    const style = (locator: ReturnType<Page['locator']>) =>
      locator.evaluate((el) => {
        const computed = window.getComputedStyle(el)
        return { opacity: computed.opacity, cursor: computed.cursor }
      })
    expect(await style(finish)).toEqual({ opacity: '0.5', cursor: 'not-allowed' })
    expect((await style(page.getByRole('button', { name: /Previous Step/i }))).opacity).toBe('1')
  })

  test('entering the wizard from the nav lands on the step to do, not one already done', async ({ page }) => {
    // The selected step persisted across tabs, so an operator who last looked
    // at a completed step (or came back next session) landed on it again, with
    // "Next recommended step" on Status & Info naming that done step too.
    await openGuidedSetup(page)
    const current = page.locator('[data-step-state="current"]')
    await expect(current).toHaveClass(/is-active/)
    const currentTitle = (await current.locator('span').first().textContent()) ?? ''
    // Look at the completed first step, leave by the nav, come back by the nav.
    await page.getByTestId('setup-step-link').click()
    await expect(page.getByTestId('setup-step-link')).toHaveClass(/is-active/)
    await page.getByTestId('view-button-setup').click()
    await expect(page.getByText(/Next recommended step:/)).toContainText(`Next recommended step: ${currentTitle}.`)
    await page.getByTestId('view-button-guided-setup').click()
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    await expect(page.locator('[data-step-state="current"]')).toHaveClass(/is-active/)
    await expect(page.getByTestId('setup-step-link')).not.toHaveClass(/is-active/)
  })

  test('the header says where it is in words, and support actions do not outshine the hero', async ({ page }) => {
    await openGuidedSetup(page, 'link')
    // The step number lives in the eyebrow and on the rail chip; the panel
    // header no longer repeats it, and the raw sequence enum ("current",
    // "locked") is no longer a badge.
    await expect(page.locator('.setup-wizard__header .eyebrow')).toHaveText(/^Step 1 of \d+$/)
    await expect(page.locator('.setup-wizard__header-status')).not.toContainText(/\b(current|locked)\b/)
    await expect(page.getByRole('button', { name: /^Back to Status & Info$/ })).toBeVisible()

    // Vehicle Link is complete once synced, so Continue is the hero and the
    // step's own Re-sync falls into the support bucket -- where its descriptor
    // tone used to paint it as the green primary among grey buttons.
    await expect(page.getByRole('button', { name: /Continue to Ports/i })).toBeEnabled()
    const support = page.locator('.setup-wizard__support-actions button')
    expect(await support.count()).toBeGreaterThan(0)
    const colors = await support.evaluateAll((els) => els.map((el) => window.getComputedStyle(el).color))
    // primary = #0a1308, hero = #111111
    expect(colors.filter((color) => color === 'rgb(10, 19, 8)' || color === 'rgb(17, 17, 17)')).toEqual([])
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
