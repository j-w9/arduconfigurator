// RC mixer state, extracted from App.tsx as part of its decomposition. Owns the
// assignment list and derives the per-channel grouping, the function lookup, and
// the live PWM map the RcMixer view renders, plus the add/remove/update handlers.
// Behavior-neutral lift of the original App() hooks (same dependency arrays).

import { useCallback, useMemo, useState } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  buildRcMixerFunctionLookup,
  createAssignment,
  createIdleRcMixerState,
  groupAssignmentsByChannel,
  type RcMixerAssignment,
  type RcMixerState
} from '../view-models/rc-mixer'

export function useRcMixer(snapshot: ConfiguratorSnapshot) {
  const [rcMixerState, setRcMixerState] = useState<RcMixerState>(createIdleRcMixerState)
  const rcMixerFunctionLookup = useMemo(() => buildRcMixerFunctionLookup(), [])
  const rcMixerChannels = useMemo(
    () => groupAssignmentsByChannel(rcMixerState.assignments),
    [rcMixerState.assignments]
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
    rcMixerFunctionLookup,
    rcMixerLivePwmByChannel,
    handleRcMixerAddAssignment,
    handleRcMixerRemoveAssignment,
    handleRcMixerUpdateAssignment
  }
}
