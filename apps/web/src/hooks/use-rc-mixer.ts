// RC mixer state, extracted from App.tsx as part of its decomposition. Owns the
// assignment list and derives the per-channel grouping, the function lookup, and
// the live PWM map the RcMixer view renders, plus the add/remove/update handlers.
// Behavior-neutral lift of the original App() hooks (same dependency arrays).

import { useCallback, useMemo, useState } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { derivePrimaryStickChannels } from '../rc-channel-helpers'
import {
  buildRcMixerFunctionLookup,
  createAssignment,
  createIdleRcMixerState,
  filterRcMixerFunctionCatalogForVehicle,
  groupAssignmentsByChannel,
  orderRcMixerFunctionCatalog,
  RC_MIXER_FUNCTION_CATALOG,
  type RcMixerAssignment,
  type RcMixerState
} from '../view-models/rc-mixer'

export function useRcMixer(snapshot: ConfiguratorSnapshot) {
  const [rcMixerState, setRcMixerState] = useState<RcMixerState>(createIdleRcMixerState)
  // Scaffold catalog covers all four vehicles' worth of BF-style AUX ideas;
  // filter to what the connected firmware actually supports (AutoTune/LAND/
  // parachutes/Precision Loiter/airmode aren't universal) rather than
  // showing Rover a "Precision Loiter" entry it can never use.
  const rcMixerFunctionCatalog = useMemo(
    () =>
      orderRcMixerFunctionCatalog(
        filterRcMixerFunctionCatalogForVehicle(RC_MIXER_FUNCTION_CATALOG, snapshot.vehicle?.vehicle)
      ),
    [snapshot.vehicle?.vehicle]
  )
  const rcMixerFunctionLookup = useMemo(
    () => buildRcMixerFunctionLookup(rcMixerFunctionCatalog),
    [rcMixerFunctionCatalog]
  )
  const excludedChannels = useMemo(() => derivePrimaryStickChannels(snapshot), [snapshot])
  const rcMixerChannels = useMemo(
    () => groupAssignmentsByChannel(rcMixerState.assignments, 16, excludedChannels),
    [rcMixerState.assignments, excludedChannels]
  )
  const rcMixerLivePwmByChannel = useMemo(() => {
    const map = new Map<number, number>()
    snapshot.liveVerification.rcInput.channels.forEach((pwm, index) => {
      if (typeof pwm === 'number' && Number.isFinite(pwm)) {
        map.set(index + 1, pwm)
      }
    })
    return map
  }, [snapshot.liveVerification.rcInput.channels])
  const handleRcMixerAddAssignment = useCallback((channel: number) => {
    setRcMixerState((current) => ({
      assignments: [...current.assignments, createAssignment(channel, 0)]
    }))
  }, [])
  const handleRcMixerRemoveAssignment = useCallback((assignmentId: string) => {
    setRcMixerState((current) => ({
      assignments: current.assignments.filter((assignment) => assignment.id !== assignmentId)
    }))
  }, [])
  const handleRcMixerUpdateAssignment = useCallback((assignmentId: string, patch: Partial<RcMixerAssignment>) => {
    setRcMixerState((current) => ({
      assignments: current.assignments.map((assignment) =>
        assignment.id === assignmentId ? { ...assignment, ...patch } : assignment
      )
    }))
  }, [])

  return {
    rcMixerChannels,
    rcMixerFunctionCatalog,
    rcMixerFunctionLookup,
    rcMixerLivePwmByChannel,
    handleRcMixerAddAssignment,
    handleRcMixerRemoveAssignment,
    handleRcMixerUpdateAssignment
  }
}
