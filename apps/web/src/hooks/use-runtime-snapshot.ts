import { useEffect, useState } from 'react'
import type { ArduPilotConfiguratorRuntime, ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/**
 * Owns the configurator-snapshot state and the runtime subscription
 * lifecycle. Extracted verbatim from App.tsx: re-syncs from the runtime
 * on (re)subscribe, and on unmount or runtime change unsubscribes then
 * disconnects + destroys the previous runtime. Behaviour is byte-identical
 * to the inline version it replaced.
 */
export function useRuntimeSnapshot(runtime: ArduPilotConfiguratorRuntime): ConfiguratorSnapshot {
  const [snapshot, setSnapshot] = useState<ConfiguratorSnapshot>(runtime.getSnapshot())

  useEffect(() => {
    setSnapshot(runtime.getSnapshot())
    const unsubscribe = runtime.subscribe(setSnapshot)
    return () => {
      unsubscribe()
      void runtime.disconnect().catch(() => {}).finally(() => {
        runtime.destroy()
      })
    }
  }, [runtime])

  return snapshot
}
