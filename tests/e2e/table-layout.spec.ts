import { expect, test, type Page } from '@playwright/test'

// Dense-table legibility guards.
//
// These exist because of a regression that shipped through a fully green suite
// (#167 -> fixed in #169): adding a preset-selection checkbox inside the
// parameter-name cell pushed the name text straight out of its grid track, so
// every row painted the parameter id and its category badge on top of the
// Description column. Unreadable, and live in production.
//
// Every assertion in the suite at the time checked that the checkbox EXISTED
// and that selection WORKED. Nothing checked that a row still rendered
// legibly, so nothing failed. The missing assertion is a geometric one, and
// that is what this file adds: a cell's rendered content must stay inside its
// own cell.
//
// The check is deliberately generic rather than a snapshot. It does not care
// what a row contains, only that no cell's content paints over its neighbour,
// which is the whole class of bug rather than the single instance of it.

const VEHICLE_CONNECT_TIMEOUT = 30_000

// A cell's content may sit a hair past its own box from sub-pixel layout and
// from glyph overhang (italics, descenders). Anything under a couple of pixels
// is invisible to an operator; the regression this guards overflowed by tens.
const OVERLAP_TOLERANCE_PX = 2

async function connect(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  // Rows stream in with the param sync; measuring before it settles races it.
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
}

async function openParameters(page: Page): Promise<void> {
  await connect(page)
  await page.getByTestId('product-mode-expert').click()
  await page.getByTestId('view-button-parameters').click()
}

type CellOverflow = {
  row: string
  cellIndex: number
  contentRight: number
  cellRight: number
  neighbourLeft: number
  overlapPx: number
  text: string
}

/**
 * Measure, for every row of a CSS-grid table, whether any cell's rendered
 * content extends into the next cell.
 *
 * Measuring the cell's own border box is not enough. A grid track with an
 * explicit minimum (`minmax(150px, 1fr)`) pins the cell box to that width, so
 * the box stays put and it is the CONTENT that escapes. That is exactly how
 * the #167 regression looked: `.parameter-row__name` sat correctly inside its
 * 150px track while the text inside it hung out over the Description column.
 * So we take the furthest-right edge of the cell and all of its descendants.
 */
async function findCellOverflow(page: Page, rowSelector: string, tolerance: number): Promise<CellOverflow[]> {
  return page.evaluate(
    ({ rowSelector, tolerance }) => {
      const findings: CellOverflow[] = []
      const rows = Array.from(document.querySelectorAll<HTMLElement>(rowSelector))

      for (const row of rows) {
        // Only side-by-side grid rows are meaningful here. When a narrow
        // viewport collapses the row to one column the cells stack, and
        // "the next cell" is below rather than beside, so there is nothing
        // to overlap.
        //
        // Detect that by asking whether all the cells share a horizontal band,
        // NOT by comparing their top edges. `align-items: center` gives a
        // one-line cell and a two-line cell different tops on the very same
        // row, so a top-equality test reads every populated row as "stacked"
        // and silently skips the entire table. That mistake made an earlier
        // draft of this guard pass against a table that was visibly broken.
        const cells = Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
        if (cells.length < 2) {
          continue
        }
        const rects = cells.map((cell) => cell.getBoundingClientRect())
        const lowestTop = Math.max(...rects.map((rect) => rect.top))
        const highestBottom = Math.min(...rects.map((rect) => rect.bottom))
        if (lowestTop >= highestBottom) {
          continue
        }

        for (let index = 0; index < cells.length - 1; index += 1) {
          const cell = cells[index]
          const neighbour = cells[index + 1]
          const neighbourLeft = neighbour.getBoundingClientRect().left

          // A cell that legitimately clips its own overflow (overflow:hidden,
          // auto, scroll) cannot paint outside itself whatever its content
          // measures, so its descendants are not evidence of anything.
          const cellRect = cell.getBoundingClientRect()
          const clips = (() => {
            const style = getComputedStyle(cell)
            return style.overflowX !== 'visible'
          })()

          let contentRight = cellRect.right
          if (!clips) {
            for (const descendant of Array.from(cell.querySelectorAll<HTMLElement>('*'))) {
              const style = getComputedStyle(descendant)
              if (style.display === 'none' || style.visibility === 'hidden') {
                continue
              }
              const rect = descendant.getBoundingClientRect()
              if (rect.width === 0 && rect.height === 0) {
                continue
              }
              contentRight = Math.max(contentRight, rect.right)
            }
          }

          const overlapPx = contentRight - neighbourLeft
          if (overlapPx > tolerance) {
            findings.push({
              row: row.getAttribute('data-param-row') ?? row.className,
              cellIndex: index,
              contentRight: Math.round(contentRight),
              cellRight: Math.round(cellRect.right),
              neighbourLeft: Math.round(neighbourLeft),
              overlapPx: Math.round(overlapPx),
              text: (cell.textContent ?? '').trim().slice(0, 60)
            })
          }
        }
      }

      return findings
    },
    { rowSelector, tolerance }
  )
}

test.describe('Dense table layout', () => {
  test('a parameter row never paints its name over the Description column', async ({ page }) => {
    // 1280 is the width the regression was reported at, and it is where the
    // parameter grid's tracks sit closest to their declared minimums.
    await page.setViewportSize({ width: 1280, height: 900 })
    await openParameters(page)

    // Long ids with a category badge are the worst case for the name cell, so
    // measure those rather than whatever happens to be at the top of the list.
    await page.getByTestId('parameter-search-input').fill('ATC_RAT_')
    const rows = page.locator('.parameter-row:not(.parameter-row--header)')
    await expect(rows.first()).toBeVisible()

    const overflow = await findCellOverflow(page, '.parameter-row:not(.parameter-row--header)', OVERLAP_TOLERANCE_PX)
    expect(
      overflow,
      `Parameter cells overflowed into the next column: ${JSON.stringify(overflow, undefined, 2)}`
    ).toEqual([])
  })

  test('the preset checkbox does not push the parameter name out of its cell', async ({ page }) => {
    // The regression's precise mechanism: the checkbox only renders in Expert
    // mode (it is what `onCreateUserPreset` gates on), and it is the extra
    // ~19px of it that consumed the name cell. Assert directly against the
    // name element and the Description cell so a failure names the cause.
    await page.setViewportSize({ width: 1280, height: 900 })
    await openParameters(page)

    await page.getByTestId('parameter-search-input').fill('ATC_RAT_RLL_FLTD')
    const row = page.locator('.parameter-row[data-param-row="ATC_RAT_RLL_FLTD"]')
    await expect(row).toBeVisible()
    // Guard the guard: if the checkbox ever stops rendering, this test would
    // pass for the wrong reason.
    await expect(page.getByTestId('parameter-preset-select-ATC_RAT_RLL_FLTD')).toBeVisible()

    const measurement = await row.evaluate((element) => {
      const name = element.querySelector<HTMLElement>('.parameter-row__name')
      const description = element.children[1] as HTMLElement | undefined
      if (!name || !description) {
        return undefined
      }
      // The escaping element is the inner wrapper holding <strong>id</strong>
      // and the category <small>, not the flex container around it.
      const inner = Array.from(name.querySelectorAll<HTMLElement>(':scope > span')).filter(
        (span) => !span.classList.contains('parameter-row__caret')
      )
      const nameContentRight = inner.reduce(
        (right, span) => Math.max(right, span.getBoundingClientRect().right),
        name.getBoundingClientRect().left
      )
      return {
        nameCellRight: name.getBoundingClientRect().right,
        nameContentRight,
        descriptionLeft: description.getBoundingClientRect().left
      }
    })

    expect(measurement).toBeDefined()
    // The name's text must end before the Description column begins.
    expect(
      measurement!.nameContentRight,
      `parameter name content ended at ${measurement!.nameContentRight} but Description starts at ${measurement!.descriptionLeft}`
    ).toBeLessThanOrEqual(measurement!.descriptionLeft + OVERLAP_TOLERANCE_PX)
  })

  test('the row-select checkbox stays checkbox-sized and the name stays legible', async ({ page }) => {
    // The bug this guards is a CSS specificity trap, and it is the one that was
    // actually live: `.parameter-row input` is the value-editor rule (width:100%,
    // padding, border) and it out-specifies `.parameter-row__select`, so the
    // checkbox inflated to the full width of the name cell and squeezed the id
    // to zero width. The Parameter column rendered blank.
    //
    // A width assertion is the cheapest possible statement of "this control is
    // still a checkbox", and a non-zero name width is the cheapest possible
    // statement of "the row still says which parameter it is".
    await page.setViewportSize({ width: 1280, height: 900 })
    await openParameters(page)

    await page.getByTestId('parameter-search-input').fill('ATC_RAT_')
    await expect(page.locator('.parameter-row:not(.parameter-row--header)').first()).toBeVisible()

    const rows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('.parameter-row:not(.parameter-row--header)'))
        .slice(0, 20)
        .map((row) => {
          const checkbox = row.querySelector<HTMLElement>('.parameter-row__select')
          const name = row.querySelector<HTMLElement>('.parameter-row__name > span:not(.parameter-row__caret)')
          return {
            id: row.getAttribute('data-param-row'),
            checkboxWidth: checkbox ? Math.round(checkbox.getBoundingClientRect().width) : undefined,
            nameWidth: name ? Math.round(name.getBoundingClientRect().width) : undefined
          }
        })
    })

    expect(rows.length).toBeGreaterThan(0)
    // A native checkbox is ~13-16px. Anything past 24px means it has picked up
    // text-input sizing from somewhere.
    const inflated = rows.filter((row) => row.checkboxWidth === undefined || row.checkboxWidth > 24)
    expect(inflated, `row-select checkboxes are not checkbox-sized: ${JSON.stringify(inflated)}`).toEqual([])

    // 60px is well under any real parameter id but far above the zero the
    // regression produced, so this fails loudly on "blank" without becoming a
    // brittle assertion about exact text width.
    const squeezed = rows.filter((row) => row.nameWidth === undefined || row.nameWidth < 60)
    expect(squeezed, `parameter names collapsed in their cell: ${JSON.stringify(squeezed)}`).toEqual([])
  })

  test('every parameter row has exactly as many cells as the header', async ({ page }) => {
    // A cheap structural companion to the geometric check: a row that grows or
    // loses a cell silently shifts every column after it. This is the failure
    // mode that was FIRST suspected for #167 — it was not the cause that time,
    // but it is a real and otherwise-unguarded way to break the same table.
    await page.setViewportSize({ width: 1280, height: 900 })
    await openParameters(page)

    const counts = await page.evaluate(() => {
      const header = document.querySelector('.parameter-row--header')
      const rows = Array.from(document.querySelectorAll('.parameter-row:not(.parameter-row--header)'))
      return {
        header: header ? header.children.length : -1,
        // The inline detail panel is a sibling row, not a cell, so only count
        // rows that are actually parameter rows.
        rows: rows.map((row) => ({
          id: row.getAttribute('data-param-row'),
          cells: row.children.length
        }))
      }
    })

    expect(counts.header).toBe(6)
    const mismatched = counts.rows.filter((row) => row.cells !== counts.header)
    expect(mismatched, `rows whose cell count differs from the header: ${JSON.stringify(mismatched)}`).toEqual([])
  })
})
