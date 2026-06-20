// Tuning-tab workbench state, extracted from App.tsx as another
// decomposition slice. Eight useState hooks the Tuning view owns
// end-to-end:
//
//   tuningTaskOverride          — operator-pinned sub-task (rates/PID/etc.)
//   tuningRollPitchLinked       — link the Roll and Pitch PID columns
//   showAdvancedTuningControls  — expose IMAX/PDMX/SMAX rows
//   tuningMasterPiGain          — multiplier the "Master adjustments" sliders write through
//   tuningMasterDGain
//   tuningMasterFeedforwardGain
//   tuningMasterPitchRatio      — separate pitch scale on top of the PI gain
//   tuningMasterFilterStrength
//
// Behavior-neutral lift — identical setters, same defaults (1 for the
// master scales, `true` for the roll/pitch link, `false` / undefined
// elsewhere).

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { TuningTaskId } from '../views/Tuning'

export interface UseTuningWorkbenchResult {
  tuningTaskOverride: TuningTaskId | undefined
  setTuningTaskOverride: Dispatch<SetStateAction<TuningTaskId | undefined>>
  tuningRollPitchLinked: boolean
  setTuningRollPitchLinked: Dispatch<SetStateAction<boolean>>
  showAdvancedTuningControls: boolean
  setShowAdvancedTuningControls: Dispatch<SetStateAction<boolean>>
  tuningMasterPiGain: number
  setTuningMasterPiGain: Dispatch<SetStateAction<number>>
  tuningMasterDGain: number
  setTuningMasterDGain: Dispatch<SetStateAction<number>>
  tuningMasterFeedforwardGain: number
  setTuningMasterFeedforwardGain: Dispatch<SetStateAction<number>>
  tuningMasterPitchRatio: number
  setTuningMasterPitchRatio: Dispatch<SetStateAction<number>>
  tuningMasterFilterStrength: number
  setTuningMasterFilterStrength: Dispatch<SetStateAction<number>>
}

export function useTuningWorkbench(): UseTuningWorkbenchResult {
  const [tuningTaskOverride, setTuningTaskOverride] = useState<TuningTaskId | undefined>()
  const [tuningRollPitchLinked, setTuningRollPitchLinked] = useState(true)
  const [showAdvancedTuningControls, setShowAdvancedTuningControls] = useState(false)
  const [tuningMasterPiGain, setTuningMasterPiGain] = useState(1)
  const [tuningMasterDGain, setTuningMasterDGain] = useState(1)
  const [tuningMasterFeedforwardGain, setTuningMasterFeedforwardGain] = useState(1)
  const [tuningMasterPitchRatio, setTuningMasterPitchRatio] = useState(1)
  const [tuningMasterFilterStrength, setTuningMasterFilterStrength] = useState(1)

  return {
    tuningTaskOverride,
    setTuningTaskOverride,
    tuningRollPitchLinked,
    setTuningRollPitchLinked,
    showAdvancedTuningControls,
    setShowAdvancedTuningControls,
    tuningMasterPiGain,
    setTuningMasterPiGain,
    tuningMasterDGain,
    setTuningMasterDGain,
    tuningMasterFeedforwardGain,
    setTuningMasterFeedforwardGain,
    tuningMasterPitchRatio,
    setTuningMasterPitchRatio,
    tuningMasterFilterStrength,
    setTuningMasterFilterStrength
  }
}
