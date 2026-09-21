import { expect, type Page } from '@playwright/test'

/**
 * Horizontal-overflow gate for a rendered page.
 *
 * The obvious measure does not work here. Every earlier version of this check
 * read `document.documentElement.scrollWidth - clientWidth`, but `html` AND
 * `body` both set `overflow-x: clip` (deliberately: `clip` suppresses sideways
 * scrolling without making them scroll containers, which is what keeps the
 * sticky side nav working). Clipped content never grows
 * `documentElement.scrollWidth`, so a card forced to 700px on a 390px screen
 * still measured 0 — the assertion passed on any layout, however broken.
 *
 * `body.scrollWidth` is not the answer either: it counts the content of
 * legitimate horizontal scrollers, so the nav rail alone reads as ~13px of
 * "overflow" on a perfectly healthy phone layout.
 *
 * What is left is the honest definition: an element is too wide when its right
 * edge passes the viewport AND nothing between it and the body is a scroll
 * container that would clip or scroll it. Elements hidden from layout are
 * skipped — a zero-size box cannot widen anything.
 *
 * Returns the worst offender's overshoot in px plus a crude identifier, so a
 * failure names the element instead of only the number.
 */
export async function worstViewportOverflow(page: Page): Promise<{ worst: number; culprit: string }> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth

    const isScroller = (node: Element): boolean => {
      const { overflowX } = window.getComputedStyle(node)
      return overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden' || overflowX === 'clip'
    }

    let worst = 0
    let culprit = ''

    for (const node of document.querySelectorAll('body *')) {
      const box = node.getBoundingClientRect()
      // A zero-size box cannot widen the page; 2px of tolerance absorbs
      // sub-pixel rounding on fractional device pixel ratios.
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= viewport + 2) continue

      let clipped = false
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (isScroller(parent)) {
          clipped = true
          break
        }
      }
      if (clipped) continue

      if (box.right - viewport > worst) {
        worst = Math.round(box.right - viewport)
        culprit = `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`
      }
    }

    return { worst, culprit }
  })
}

/** Assert nothing on the page sticks out past the right edge of the viewport. */
export async function expectNoViewportOverflow(page: Page, what: string): Promise<void> {
  const { worst, culprit } = await worstViewportOverflow(page)
  expect(worst, `${what}: ${worst}px past the right edge (${culprit})`).toBeLessThanOrEqual(2)
}
