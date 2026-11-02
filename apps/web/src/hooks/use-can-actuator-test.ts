// The CAN tab's ESC and Servo bench tools: the values on screen, and the
// repeating send that drives them.
//
// A run sends the live slider values every ACTUATOR_SEND_PERIOD_MS (the frames
// are rebuilt each tick, so a slider move takes effect at once), with safety
// OFF + armed for AP_Periph nodes that need them. However a run ends -- Stop,
// the vehicle arming, the bus going away, the page or browser tab being left,
// the safety box unticked -- the hook sends zeros (and safety ON + disarmed)
// so nothing is left spinning on the last command until a timeout catches it.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DronecanCatalogue, DronecanValue } from '@arduconfig/dronecan-dsdl'

import { useCanSender, type CanFrameSink, type CanSendJob } from './use-can-sender'
import { buildDronecanSendFrames, type CanSendFrame } from '../view-models/can-send'
import {
  ACTUATOR_ARRAY_COMMAND,
  ACTUATOR_MAX_PER_MESSAGE,
  ACTUATOR_SEND_PERIOD_MS,
  ARMING_STATUS,
  ESC_DEFAULT_LIMIT_PCT,
  ESC_MAX_CHANNELS,
  ESC_RAW_COMMAND,
  SAFETY_STATE,
  SERVO_PWM_CENTER,
  armingStatusValue,
  buildEscRawCommandValue,
  buildEscStopValue,
  buildServoArrayCommandValues,
  clampServoValue,
  safetyStateValue,
  type ServoChannel,
  type ServoCommandType
} from '../view-models/can-actuators'

export type ActuatorTool = 'esc' | 'servo'

export interface UseCanActuatorTestResult {
  running: ActuatorTool | undefined
  /** Why the last run stopped, when it was not the operator. */
  stopNote?: string
  escCount: number
  setEscCount: (count: number) => void
  escPercents: readonly number[]
  setEscPercent: (index: number, percent: number) => void
  setAllEscPercent: (percent: number) => void
  escLimitPct: number
  setEscLimitPct: (limit: number) => void
  servoType: ServoCommandType
  setServoType: (type: ServoCommandType) => void
  servoChannels: readonly ServoChannel[]
  setServoValue: (index: number, value: number) => void
  setServoActuatorId: (index: number, actuatorId: number) => void
  addServo: () => void
  removeServo: (index: number) => void
  centerServos: () => void
  /** Send ArduPilot SafetyState OFF + ArmingStatus armed while running. */
  sendArming: boolean
  setSendArming: (value: boolean) => void
  start: (tool: ActuatorTool) => void
  stop: () => void
}

function frames(catalogue: DronecanCatalogue, fullName: string, value: { [field: string]: DronecanValue }, transferId: number, sourceNodeId: number): CanSendFrame[] {
  return buildDronecanSendFrames(catalogue, { fullName, kind: 'message', value, priority: 8, sourceNodeId, transferId }).frames
}

export function useCanActuatorTest(options: {
  sink: CanFrameSink | undefined
  catalogue: DronecanCatalogue
  sourceNodeId: number
  active: boolean
  armed: boolean
  /** An ESC/Servo page is on screen. */
  visible: boolean
  acknowledged: boolean
}): UseCanActuatorTestResult {
  const { sink, catalogue, sourceNodeId, active, armed, acknowledged } = options
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const onChange = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  // A hidden browser tab throttles timers to ~1 Hz: an ESC would twitch between
  // its timeout and the next command. Hidden counts as leaving the page.
  const visible = options.visible && documentVisible
  const sender = useCanSender({ sink, active, armed, visible, motionAcknowledged: acknowledged })

  const [escCount, setEscCountState] = useState(4)
  const [escPercents, setEscPercents] = useState<number[]>(() => new Array(ESC_MAX_CHANNELS).fill(0))
  const [escLimitPct, setEscLimitState] = useState(ESC_DEFAULT_LIMIT_PCT)
  const [servoType, setServoTypeState] = useState<ServoCommandType>('pwm')
  const [servoChannels, setServoChannels] = useState<ServoChannel[]>(() =>
    [1, 2, 3, 4].map((actuatorId) => ({ actuatorId, value: SERVO_PWM_CENTER }))
  )
  const [sendArming, setSendArming] = useState(true)
  const [running, setRunning] = useState<ActuatorTool | undefined>(undefined)
  const [stopNote, setStopNote] = useState<string | undefined>(undefined)

  // The tick reads these, not the closure: a slider move lands on the next send.
  const live = useRef({ escCount, escPercents, escLimitPct, servoType, servoChannels, sendArming })
  live.current = { escCount, escPercents, escLimitPct, servoType, servoChannels, sendArming }

  const buildRun = useCallback(
    (tool: ActuatorTool) =>
      (transferId: number): CanSendFrame[] => {
        const now = live.current
        const out: CanSendFrame[] = []
        if (now.sendArming) {
          out.push(...frames(catalogue, SAFETY_STATE, safetyStateValue(true), transferId, sourceNodeId))
          out.push(...frames(catalogue, ARMING_STATUS, armingStatusValue(true), transferId, sourceNodeId))
        }
        if (tool === 'esc') {
          out.push(...frames(catalogue, ESC_RAW_COMMAND, buildEscRawCommandValue(now.escPercents, now.escCount, now.escLimitPct), transferId, sourceNodeId))
        } else {
          const [message] = buildServoArrayCommandValues(now.servoChannels, now.servoType)
          if (message) out.push(...frames(catalogue, ACTUATOR_ARRAY_COMMAND, message, transferId, sourceNodeId))
        }
        return out
      },
    [catalogue, sourceNodeId]
  )

  const sendStop = useCallback(
    (tool: ActuatorTool) => {
      if (!sink) return
      // Zeros for ESCs (servos simply stop being commanded and hold / time
      // out), then safety ON + disarmed. Three times: a single lost frame
      // must not leave a motor on its last command.
      const job: CanSendJob = {
        label: tool === 'esc' ? 'ESC stop' : 'Servo stop',
        hazard: undefined,
        dronecan: { counterKey: 'actuator-test' },
        build: (transferId) => [
          ...(tool === 'esc' ? frames(catalogue, ESC_RAW_COMMAND, buildEscStopValue(live.current.escCount), transferId, sourceNodeId) : []),
          ...(live.current.sendArming
            ? [
                ...frames(catalogue, SAFETY_STATE, safetyStateValue(false), transferId, sourceNodeId),
                ...frames(catalogue, ARMING_STATUS, armingStatusValue(false), transferId, sourceNodeId)
              ]
            : [])
        ]
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        window.setTimeout(() => void sender.send(job), attempt * 30)
      }
    },
    [catalogue, sender, sink, sourceNodeId]
  )

  const runningRef = useRef<ActuatorTool | undefined>(undefined)
  const stoppingByUs = useRef(false)

  const start = useCallback(
    (tool: ActuatorTool) => {
      setStopNote(undefined)
      runningRef.current = tool
      setRunning(tool)
      sender.startRepeat(
        { label: tool === 'esc' ? 'ESC test' : 'Servo test', hazard: 'motion', dronecan: { counterKey: 'actuator-test' }, build: buildRun(tool) },
        ACTUATOR_SEND_PERIOD_MS
      )
    },
    [buildRun, sender]
  )

  const stop = useCallback(() => {
    stoppingByUs.current = true
    sender.stopRepeat('Stopped.')
  }, [sender])

  // However the repeat ended, finish it the same way: stop frames, then idle.
  useEffect(() => {
    if (sender.repeatingId !== undefined || runningRef.current === undefined) return
    const tool = runningRef.current
    runningRef.current = undefined
    setRunning(undefined)
    if (!stoppingByUs.current) {
      const last = sender.history.find((entry) => entry.status === 'stopped')
      setStopNote(last?.note ?? 'Stopped.')
    }
    stoppingByUs.current = false
    if (active) sendStop(tool)
  }, [active, sendStop, sender.history, sender.repeatingId])

  return {
    running,
    stopNote,
    escCount,
    setEscCount: (count) => setEscCountState(Math.min(ESC_MAX_CHANNELS, Math.max(1, Math.round(count) || 1))),
    escPercents,
    setEscPercent: (index, percent) =>
      setEscPercents((current) => current.map((value, at) => (at === index ? Math.min(escLimitPct, Math.max(0, percent)) : value))),
    setAllEscPercent: (percent) =>
      setEscPercents((current) => current.map((value, at) => (at < escCount ? Math.min(escLimitPct, Math.max(0, percent)) : value))),
    escLimitPct,
    setEscLimitPct: (limit) => {
      const next = Math.min(100, Math.max(1, Math.round(limit) || 1))
      setEscLimitState(next)
      setEscPercents((current) => current.map((value) => Math.min(next, value)))
    },
    servoType,
    setServoType: (type) => {
      setServoTypeState(type)
      setServoChannels((current) => current.map((channel) => ({ ...channel, value: type === 'pwm' ? SERVO_PWM_CENTER : 0 })))
    },
    servoChannels,
    setServoValue: (index, value) =>
      setServoChannels((current) => current.map((channel, at) => (at === index ? { ...channel, value: clampServoValue(servoType, value) } : channel))),
    setServoActuatorId: (index, actuatorId) =>
      setServoChannels((current) =>
        current.map((channel, at) => (at === index ? { ...channel, actuatorId: Math.min(255, Math.max(1, Math.round(actuatorId) || 1)) } : channel))
      ),
    addServo: () =>
      setServoChannels((current) =>
        current.length >= ACTUATOR_MAX_PER_MESSAGE
          ? current
          : [...current, { actuatorId: Math.max(0, ...current.map((channel) => channel.actuatorId)) + 1, value: servoType === 'pwm' ? SERVO_PWM_CENTER : 0 }]
      ),
    removeServo: (index) => setServoChannels((current) => (current.length <= 1 ? current : current.filter((_, at) => at !== index))),
    centerServos: () => setServoChannels((current) => current.map((channel) => ({ ...channel, value: servoType === 'pwm' ? SERVO_PWM_CENTER : 0 }))),
    sendArming,
    setSendArming,
    start,
    stop
  }
}
