// Guided-action labels + id type, extracted from App.tsx so types and helpers
// that key off the guided-action set don't have to live next to the const.
export const actionLabels = {
  'request-parameters': 'Pull Parameters',
  'calibrate-accelerometer': 'Calibrate Accelerometer',
  'calibrate-level': 'Calibrate Level',
  'calibrate-compass': 'Calibrate Compass',
  'reboot-autopilot': 'Request Reboot'
} as const

export type GuidedActionId = keyof typeof actionLabels
