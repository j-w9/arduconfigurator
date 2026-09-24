// The Primary / Secondary GPS cards, moved off Ports.
//
// They say whether a configured driver is actually TALKING -- which is the
// question an operator has when a GPS will not fix -- so they belong beside the
// GPS settings rather than above a table of UARTs. They deliberately carry NO
// driver editor: GPS_TYPE is a labelled field on this same sub-tab and
// GPS_TYPE2 is in Additional GPS settings just below, and a third editor for
// the same two parameters is how an operator loses track of which one won.

import type { ReactElement } from 'react'
import { StatusBadge } from '@arduconfig/ui-kit'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { formatArducopterGpsType } from '@arduconfig/param-metadata'

import type { GpsPeripheralViewModel } from '../view-models/peripherals'

export interface GpsPeripheralCardsProps {
  snapshot: ConfiguratorSnapshot
  gpsPeripheralViewModels: readonly GpsPeripheralViewModel[]
}

export function GpsPeripheralCards({
  snapshot,
  gpsPeripheralViewModels
}: GpsPeripheralCardsProps): ReactElement | null {
  if (gpsPeripheralViewModels.length === 0) {
    return null
  }

  const { globalPosition, gpsReceiver } = snapshot.liveVerification

  return (
    <div className="port-card-grid" data-testid="peripherals-gps-cards">
      {gpsPeripheralViewModels.map((peripheral) => {
        const isPrimary = peripheral.id === 'primary'

        return (
          <article key={peripheral.label} className="port-card">
            <div className="port-card__header">
              <div>
                <strong>{peripheral.label}</strong>
                <small>Configured driver: {formatArducopterGpsType(peripheral.value)}</small>
              </div>
              <StatusBadge
                tone={
                  peripheral.value === 0
                    ? 'neutral'
                    : isPrimary && globalPosition.verified
                      ? 'success'
                      : isPrimary && !gpsReceiver.detected
                        ? 'danger'
                        : 'warning'
                }
              >
                {peripheral.value === 0
                  ? 'disabled'
                  : isPrimary && globalPosition.verified
                    ? 'live position'
                    : // "configured" used to cover BOTH a working GPS waiting on
                      // a fix and a GPS that was never wired up — a driver
                      // selected in a parameter reads as an accomplished setup.
                      // GPS_RAW_INT separates them: no frames at all means
                      // nothing is talking.
                      !isPrimary
                      ? 'configured'
                      : !gpsReceiver.detected
                        ? 'not detected'
                        : `no fix · ${gpsReceiver.satellitesVisible ?? 0} sats`}
              </StatusBadge>
            </div>
            <p>
              {isPrimary && globalPosition.verified
                ? 'Live position is arriving. Keep the configured driver consistent with the actual hardware after reboot and reconnect.'
                : isPrimary && !gpsReceiver.detected
                  ? 'A driver is selected but no GPS is reporting at all — not even an unfixed one. That points at wiring rather than sky view: check the module is on a UART with TX/RX the right way round (a GPS on I2C pins never reports), that the port protocol is GPS, and that the module has power.'
                  : isPrimary
                    ? 'The GPS module is reporting but has no position fix yet. This is normal indoors — give it sky view.'
                    : 'Choose the expected GPS/peripheral driver above, then verify the live device after reboot and reconnect.'}
            </p>
          </article>
        )
      })}
    </div>
  )
}
