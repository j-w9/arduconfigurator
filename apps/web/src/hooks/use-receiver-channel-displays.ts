// Receiver primary-vs-AUX channel partitioning, lifted out of App.tsx as
// the next bounded slice toward a ReceiverSection extract. Pure verbatim
// move: useMemo bodies and dep arrays are byte-identical to the original.
// The intermediate `receiverPrimaryChannelNumbers` Set was only used to
// compute the two display lists in App.tsx, so it stays private to the hook.

import { useMemo } from 'react'

import type {
  ConfiguratorSnapshot,
  ModeSwitchEstimate,
  RcAxisObservation
} from '@arduconfig/ardupilot-core'

import type { RcChannelDisplay } from '../rc-channel-helpers'
import { readRoundedParameter } from '../selectors/parameter-read'

export interface UseReceiverChannelDisplaysResult {
  receiverPrimaryChannelDisplays: RcChannelDisplay[]
  receiverAuxChannelDisplays: RcChannelDisplay[]
}

/**
 * Splits the Receiver workbench's channel-strip into "primary" (any channel
 * the operator should see at a glance — RC axes, live PWM, configured
 * RCn_OPTION, and the detected flight-mode switch) and "AUX" (the rest).
 *
 * Inputs are the live snapshot, the rcChannelDisplays list, the derived
 * RC axis observations, and the detected mode-switch estimate. Output
 * lists are derived by filtering rcChannelDisplays against the primary
 * channel-number Set; behavior is byte-identical to the App.tsx originals.
 */
export function useReceiverChannelDisplays(input: {
  snapshot: ConfiguratorSnapshot
  rcChannelDisplays: RcChannelDisplay[]
  rcAxisObservations: RcAxisObservation[]
  modeSwitchEstimate: ModeSwitchEstimate
}): UseReceiverChannelDisplaysResult {
  const { snapshot, rcChannelDisplays, rcAxisObservations, modeSwitchEstimate } = input

  const receiverPrimaryChannelNumbers = useMemo(() => {
    const channelNumbers = new Set<number>(rcAxisObservations.map((axis) => axis.channelNumber))
    // Any channel currently streaming live PWM counts as "primary" so the
    // operator sees every wired AUX/spare channel at a glance instead of
    // discovering they have to click "Show AUX Channels" to confirm a 12-
    // or 16-channel transmitter is feeding the FC. Bench evidence on a
    // CubeRed + ELRS 2.4: 8-channel link landed only ch1-4 + the mode-
    // switch ch8 in the primary view, hiding ch5-7 behind AUX even though
    // all three were streaming PWM.
    snapshot.liveVerification.rcInput.channels.forEach((pwm, index) => {
      if (typeof pwm === 'number' && pwm !== 0xffff) {
        channelNumbers.add(index + 1)
      }
    })
    // Channels with an assigned RCn_OPTION are still surfaced even when
    // silent — they're documented intent, not just live evidence.
    for (let channelNumber = 5; channelNumber <= 16; channelNumber += 1) {
      const optionValue = readRoundedParameter(snapshot, `RC${channelNumber}_OPTION`)
      if (optionValue !== undefined && optionValue !== 0) {
        channelNumbers.add(channelNumber)
      }
    }
    if (modeSwitchEstimate.channelNumber !== undefined) {
      channelNumbers.add(modeSwitchEstimate.channelNumber)
    }
    return channelNumbers
  }, [modeSwitchEstimate.channelNumber, rcAxisObservations, snapshot])
  const receiverPrimaryChannelDisplays = useMemo(
    () => rcChannelDisplays.filter((channel) => receiverPrimaryChannelNumbers.has(channel.channelNumber)),
    [rcChannelDisplays, receiverPrimaryChannelNumbers]
  )
  const receiverAuxChannelDisplays = useMemo(
    () => rcChannelDisplays.filter((channel) => !receiverPrimaryChannelNumbers.has(channel.channelNumber)),
    [rcChannelDisplays, receiverPrimaryChannelNumbers]
  )

  return { receiverPrimaryChannelDisplays, receiverAuxChannelDisplays }
}
