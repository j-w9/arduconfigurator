// Safety-acknowledgment gates extracted from App.tsx as the next slice
// of its decomposition. Six independent boolean confirms the operator
// has to flip ON before destructive / hands-on actions are allowed:
//
//   propsRemovedAcknowledged             motor test / motor reorder
//   testAreaAcknowledged                 motor test / motor reorder
//   usbBenchAcknowledged                 motor test when on a USB bench link
//   snapshotRestoreAcknowledged          snapshot library restore
//   provisioningRestoreAcknowledged      provisioning library restore
//   presetApplyAcknowledged              preset apply
//
// Behavior-neutral lift — identical setters, same default `false`. The
// consuming JSX destructures these names directly off the hook return
// so no call sites change.

import { useState, type Dispatch, type SetStateAction } from 'react'

export interface UseSafetyAcksResult {
  /** "Propellers are removed." Required before any motor test. */
  propsRemovedAcknowledged: boolean
  setPropsRemovedAcknowledged: Dispatch<SetStateAction<boolean>>
  /** "Test area is clear / vehicle restrained." Required before any motor test. */
  testAreaAcknowledged: boolean
  setTestAreaAcknowledged: Dispatch<SetStateAction<boolean>>
  /**
   * Extra gate when spinning motors over a physical USB link (Web Serial).
   * That's a hands-on bench scenario, so require an explicit USB-bench
   * acknowledgement on top of the props/area checks.
   */
  usbBenchAcknowledged: boolean
  setUsbBenchAcknowledged: Dispatch<SetStateAction<boolean>>
  /** Snapshot-library restore confirmation. */
  snapshotRestoreAcknowledged: boolean
  setSnapshotRestoreAcknowledged: Dispatch<SetStateAction<boolean>>
  /** Force-write the restore's blocked (out-of-range/enum) values anyway. */
  snapshotForceInvalid: boolean
  setSnapshotForceInvalid: Dispatch<SetStateAction<boolean>>
  /** Provisioning-library restore confirmation. */
  provisioningRestoreAcknowledged: boolean
  setProvisioningRestoreAcknowledged: Dispatch<SetStateAction<boolean>>
  /** Preset apply confirmation (destructive — writes a preset bundle). */
  presetApplyAcknowledged: boolean
  setPresetApplyAcknowledged: Dispatch<SetStateAction<boolean>>
}

export function useSafetyAcks(): UseSafetyAcksResult {
  const [propsRemovedAcknowledged, setPropsRemovedAcknowledged] = useState(false)
  const [testAreaAcknowledged, setTestAreaAcknowledged] = useState(false)
  const [usbBenchAcknowledged, setUsbBenchAcknowledged] = useState(false)
  const [snapshotRestoreAcknowledged, setSnapshotRestoreAcknowledged] = useState(false)
  // Operator opted to force-write the snapshot restore's blocked (out-of-doc-range
  // / outside-enum) values anyway — common on a cross-board restore where a value
  // valid on the source FC trips this app's documented range/enum.
  const [snapshotForceInvalid, setSnapshotForceInvalid] = useState(false)
  const [provisioningRestoreAcknowledged, setProvisioningRestoreAcknowledged] = useState(false)
  const [presetApplyAcknowledged, setPresetApplyAcknowledged] = useState(false)

  return {
    propsRemovedAcknowledged,
    setPropsRemovedAcknowledged,
    testAreaAcknowledged,
    setTestAreaAcknowledged,
    usbBenchAcknowledged,
    setUsbBenchAcknowledged,
    snapshotRestoreAcknowledged,
    setSnapshotRestoreAcknowledged,
    snapshotForceInvalid,
    setSnapshotForceInvalid,
    provisioningRestoreAcknowledged,
    setProvisioningRestoreAcknowledged,
    presetApplyAcknowledged,
    setPresetApplyAcknowledged
  }
}
