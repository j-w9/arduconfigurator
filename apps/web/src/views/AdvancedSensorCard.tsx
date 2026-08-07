import { StatusBadge } from '@arduconfig/ui-kit'

import type { AdvancedSensorCardViewModel } from '../view-models/advanced-sensor-cards'

/**
 * One advanced-sensor box (rangefinder / optical flow) for the Status & Info
 * tab, styled as a sibling of the existing GPS box.
 *
 * Dumb by design: every decision about which state the sensor is in, what the
 * measurement reads, and whether the card should exist at all is made by
 * `buildAdvancedSensorCards` and unit-tested there. This file only paints.
 *
 * Two rules it exists to enforce:
 *   - The fault text is rendered as visible copy, never only as a `title`.
 *     The first version of this idea put "no data received" behind a hover
 *     and an operator had to go looking for it; by the time they found it,
 *     it had already diagnosed a mis-soldered sensor — so it earns a place
 *     on the face of the card.
 *   - Colour is carried by the state class AND repeated in the badge text,
 *     so the card is readable without relying on colour alone.
 */
export function AdvancedSensorCard({ card }: { card: AdvancedSensorCardViewModel }) {
  return (
    <article
      className={`setup-gui-box setup-gui-box--sensor setup-gui-box--sensor-${card.state}`}
      data-testid={card.testId}
      data-sensor-state={card.state}
    >
      <div className="setup-gui-box__titlebar">
        <strong>{card.title}</strong>
        <StatusBadge tone={card.tone}>{card.badge}</StatusBadge>
      </div>
      <div className="setup-gui-box__body">
        {/* The headline sits ABOVE the readings: in a fault state the first
         *  thing the eye lands on must be the fault, not a column of
         *  "No data" rows the operator has to interpret. */}
        <p
          className={`setup-gui-box__sensor-headline setup-gui-box__sensor-headline--${card.tone}`}
          data-testid={`${card.testId}-headline`}
          title={card.detail}
        >
          {card.headline}
        </p>
        <div className="setup-gui-box__kv-list">
          {card.rows.map((row) => (
            <div
              key={row.label}
              className={`setup-gui-box__kv-row${row.emphasis ? ' setup-gui-box__kv-row--measurement' : ''}`}
            >
              <span>{row.label}</span>
              <strong data-testid={`${card.testId}-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                {row.value}
              </strong>
            </div>
          ))}
        </div>
        {/* Detail is duplicated as body copy, not left to the tooltip alone —
         *  it is the "what do I do about it" half of the diagnosis. */}
        <p className="setup-gui-box__note" data-testid={`${card.testId}-detail`}>
          {card.detail}
        </p>
      </div>
    </article>
  )
}
