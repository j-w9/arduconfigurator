// Pure eligibility/copy logic for the Motor Reorder dialog's "Reverse
// direction" card, extracted so the two real prerequisites for DShot reverse
// to actually work are unit-tested rather than only inline JSX conditionals.
//
// Hardware-verified (real Cube + iFlight Blitz Mini E55/AM32, 2026-07-08):
// the reverse checkbox writes SERVO_BLH_RVMASK, but that mask is only ever
// acted on by ArduPilot's RCOutput driver when SERVO_DSHOT_ESC names a real
// ESC type — with SERVO_DSHOT_ESC = 0 ("None"), the reverse (and 3D) DShot
// command is silently never sent, regardless of RVMASK or a reboot. Both
// SERVO_BLH_RVMASK and SERVO_DSHOT_ESC also only take effect on the next
// reboot (AP_BLHeli::init() / RCOutput::set_dshot_esc_type are only pushed at
// ESC-subsystem startup), which the Motor Reorder dialog's Apply button
// already forces regardless of this check.

export interface MotorReverseEligibility {
  isDShotProtocol: boolean
  escTypeConfigured: boolean
  canReverse: boolean
  /** Present iff canReverse is false — shown in place of the toggle grid. */
  blockedReason?: string
}

/** DShot MOT_PWM_TYPE values (ArduCopter enum): 4=DShot150 .. 7=DShot1200. */
function isDShotPwmType(motPwmType: number): boolean {
  return motPwmType >= 4 && motPwmType <= 7
}

export function resolveMotorReverseEligibility(inputs: {
  motPwmType: number
  /** SERVO_DSHOT_ESC value; undefined when the param isn't in the synced set. */
  dshotEscType: number | undefined
}): MotorReverseEligibility {
  const isDShotProtocol = isDShotPwmType(inputs.motPwmType)
  const escTypeConfigured = (inputs.dshotEscType ?? 0) > 0

  if (!isDShotProtocol) {
    return {
      isDShotProtocol,
      escTypeConfigured,
      canReverse: false,
      blockedReason: 'Requires a DShot ESC protocol — set MOT_PWM_TYPE to a DShot value (4-7) first.'
    }
  }
  if (!escTypeConfigured) {
    return {
      isDShotProtocol,
      escTypeConfigured,
      canReverse: false,
      blockedReason:
        'Set your ESC type below first — with SERVO_DSHOT_ESC set to "None", no DShot commands are ever sent, including reverse.'
    }
  }
  return { isDShotProtocol, escTypeConfigured, canReverse: true }
}
