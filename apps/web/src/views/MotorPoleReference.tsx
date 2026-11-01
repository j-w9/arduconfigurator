import type { ReactElement } from 'react'

/**
 * Pole-count reference for SERVO_BLH_POLES.
 *
 * The field on its own is a number with no way to check it, and getting it
 * wrong is silent: ArduPilot computes RPM = eRPM * 200 / poles
 * (AP_BLHeli.cpp:1544, and the identical line in AP_IOMCU.cpp:442), so a wrong
 * pole count produces RPM telemetry, notch tuning and logs that are all wrong
 * by exactly the same factor and never look broken.
 *
 * Deliberately short on per-motor tables. "12N14P" covers essentially the whole
 * FPV size range, and beyond it the honest answer is to count magnets rather
 * than to trust a lookup that would go stale — so that is what this says.
 */
export function MotorPoleReference(): ReactElement {
  return (
    <details className="motor-pole-reference" data-testid="motor-pole-reference">
      <summary>How many poles does my motor have?</summary>
      <p>
        Poles are the <strong>magnets in the bell</strong>, not the stator slots. Almost every FPV
        multirotor motor — roughly 1103 through 2810 — uses the 12N14P layout: 12 stator slots and{' '}
        <strong>14 poles</strong>. That is also ArduPilot&apos;s default, so if you are running a
        normal 2&quot;–7&quot; quad, 14 is already right.
      </p>
      <p>
        If you are not sure, look inside the bell and count the magnets. That count is the number to
        enter. Large heavy-lift and X-class motors often use more than 14 — do not assume there.
      </p>
      <p>
        To check it after the fact: with bidirectional DShot running, ArduPilot reports{' '}
        <code>RPM = eRPM × 200 ÷ poles</code>. Unloaded at full throttle a motor turns at roughly its
        KV × pack voltage, so if reported RPM is consistently double or half what you expect, the
        pole count is wrong by that same factor.
      </p>
    </details>
  )
}
