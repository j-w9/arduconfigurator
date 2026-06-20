// Calibration-tab feedback state, extracted from App.tsx as the next slice of
// its decomposition. Five tightly cohesive useState hooks the Calibration view
// owns end-to-end: the user-typed multimeter voltage (battery cal), three
// per-card notices (battery voltage, airspeed, ESC), and the two-step
// "armed" confirm gate for the destructive ESC calibration mode.
//
// Behavior-neutral lift — identical setters, same shapes, same defaults; the
// Calibration cards consume the returned tuple destructured the same way the
// App body used to declare them inline.

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { StatusTone } from '../status-tone'

export interface CalibrationNotice {
  tone: StatusTone
  text: string
}

export interface UseCalibrationNoticesResult {
  /** Voltage value the operator types from a multimeter for BATT_VOLT_MULT rescale. */
  batteryMeasuredVoltage: string
  setBatteryMeasuredVoltage: Dispatch<SetStateAction<string>>
  /** Current value the operator types from a clamp meter for BATT_AMP_PERVLT rescale. */
  batteryMeasuredCurrent: string
  setBatteryMeasuredCurrent: Dispatch<SetStateAction<string>>
  /** Result banner for the battery-voltage cal card (success / danger pill + text). */
  batteryCalNotice: CalibrationNotice | undefined
  setBatteryCalNotice: Dispatch<SetStateAction<CalibrationNotice | undefined>>
  /** Result banner for the airspeed cal card (Plane-only, ARSPD_AUTOCAL toggle). */
  airspeedCalNotice: CalibrationNotice | undefined
  setAirspeedCalNotice: Dispatch<SetStateAction<CalibrationNotice | undefined>>
  /** Result banner for the ESC throttle-endpoint cal card. */
  escCalNotice: CalibrationNotice | undefined
  setEscCalNotice: Dispatch<SetStateAction<CalibrationNotice | undefined>>
  /**
   * Two-step "armed" gate for ESC cal — clicking the first button arms the
   * destructive set+reboot path; the second button executes it. Reset on
   * Cancel.
   */
  escCalArmed: boolean
  setEscCalArmed: Dispatch<SetStateAction<boolean>>
}

export function useCalibrationNotices(): UseCalibrationNoticesResult {
  const [batteryMeasuredVoltage, setBatteryMeasuredVoltage] = useState('')
  const [batteryMeasuredCurrent, setBatteryMeasuredCurrent] = useState('')
  const [batteryCalNotice, setBatteryCalNotice] = useState<CalibrationNotice | undefined>(undefined)
  const [airspeedCalNotice, setAirspeedCalNotice] = useState<CalibrationNotice | undefined>(undefined)
  const [escCalNotice, setEscCalNotice] = useState<CalibrationNotice | undefined>(undefined)
  const [escCalArmed, setEscCalArmed] = useState(false)

  return {
    batteryMeasuredVoltage,
    setBatteryMeasuredVoltage,
    batteryMeasuredCurrent,
    setBatteryMeasuredCurrent,
    batteryCalNotice,
    setBatteryCalNotice,
    airspeedCalNotice,
    setAirspeedCalNotice,
    escCalNotice,
    setEscCalNotice,
    escCalArmed,
    setEscCalArmed
  }
}
