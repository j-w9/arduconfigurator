// CAN ▸ ESC and CAN ▸ Servo: bench tools that drive DroneCAN ESCs and servos
// directly, like the DroneCAN GUI Tool's ESC and Actuator panels. Dumb view:
// App owns the run (useCanActuatorTest) and passes plain props.

import type { ReactElement } from 'react'
import { buttonStyle } from '@arduconfig/ui-kit'

import type { DronecanEscRow } from '../view-models/dronecan-inspector'
import { SERVO_PWM_MAX, SERVO_PWM_MIN, type ServoChannel, type ServoCommandType } from '../view-models/can-actuators'

interface SharedProps {
  /** Why Start is off; undefined when it can run. */
  blockedReason?: string
  running: boolean
  /** Another tool is running (only one at a time). */
  otherRunning: boolean
  stopNote?: string
  acknowledged: boolean
  onAcknowledged: (value: boolean) => void
  sendArming: boolean
  onSendArming: (value: boolean) => void
  onStart: () => void
  onStop: () => void
}

function RunBar(props: SharedProps & { tool: 'esc' | 'servo' }): ReactElement {
  const { tool } = props
  return (
    <div className="can-actuators__run">
      <label className="can-actuators__ack">
        <input
          type="checkbox"
          checked={props.acknowledged}
          onChange={(event) => props.onAcknowledged(event.target.checked)}
          data-testid={`can-${tool}-ack`}
        />
        <span>Props off, area clear, craft restrained</span>
      </label>
      <label className="can-actuators__option" title="AP_Periph keeps its outputs off until it hears safety off, and takes its armed state from the bus">
        <input
          type="checkbox"
          checked={props.sendArming}
          disabled={props.running}
          onChange={(event) => props.onSendArming(event.target.checked)}
          data-testid={`can-${tool}-send-arming`}
        />
        <span>Send safety off and armed while running</span>
      </label>
      {props.running ? (
        <button type="button" className="can-actuators__stop" onClick={props.onStop} data-testid={`can-${tool}-stop`}>
          Stop
        </button>
      ) : (
        <button
          type="button"
          style={buttonStyle('primary')}
          disabled={props.blockedReason !== undefined || props.otherRunning}
          onClick={props.onStart}
          data-testid={`can-${tool}-start`}
        >
          Start
        </button>
      )}
      {props.running ? (
        <small className="can-actuators__state" data-testid={`can-${tool}-running`}>
          Sending every 50 ms
        </small>
      ) : props.blockedReason ? (
        <small className="can-actuators__state can-actuators__state--blocked" data-testid={`can-${tool}-blocked`}>
          {props.blockedReason}
        </small>
      ) : props.stopNote ? (
        <small className="can-actuators__state" data-testid={`can-${tool}-stop-note`}>
          {props.stopNote}
        </small>
      ) : null}
    </div>
  )
}

export interface CanEscToolViewProps extends SharedProps {
  count: number
  onCount: (count: number) => void
  percents: readonly number[]
  onPercent: (index: number, percent: number) => void
  onAll: (percent: number) => void
  limitPct: number
  onLimit: (limit: number) => void
  telemetry: readonly DronecanEscRow[]
}

export function CanEscToolView(props: CanEscToolViewProps): ReactElement {
  const indexes = Array.from({ length: props.count }, (_, index) => index)
  const all = indexes.length > 0 && indexes.every((index) => props.percents[index] === props.percents[0]) ? props.percents[0] ?? 0 : 0
  const telemetryFor = (index: number) => props.telemetry.find((row) => row.escIndex === index)
  return (
    <section className="can-actuators" data-testid="can-esc-tool">
      <p className="can-actuators__lede">
        Spin DroneCAN ESCs straight from here, for bench tests and ESC setup. Each slider is one RawCommand slot (ESC index).
      </p>
      <RunBar {...props} tool="esc" />
      <div className="can-actuators__settings">
        <label>
          <span>ESCs</span>
          <input
            type="number"
            min={1}
            max={20}
            value={props.count}
            disabled={props.running}
            onChange={(event) => props.onCount(Number(event.target.value))}
            data-testid="can-esc-count"
          />
        </label>
        <label>
          <span>Throttle limit (%)</span>
          <input
            type="number"
            min={1}
            max={100}
            value={props.limitPct}
            onChange={(event) => props.onLimit(Number(event.target.value))}
            data-testid="can-esc-limit"
          />
        </label>
        <button type="button" style={buttonStyle()} onClick={() => props.onAll(0)} data-testid="can-esc-zero">
          All to zero
        </button>
      </div>
      <div className="can-actuators__master">
        <span>All</span>
        <input
          type="range"
          min={0}
          max={props.limitPct}
          step={0.5}
          value={all}
          onChange={(event) => props.onAll(Number(event.target.value))}
          aria-label="All ESCs"
          data-testid="can-esc-all"
        />
        <output>{all.toFixed(1)}%</output>
      </div>
      <table className="can-actuators__table">
        <thead>
          <tr>
            <th>ESC</th>
            <th>Throttle</th>
            <th>RPM</th>
            <th>Voltage</th>
            <th>Current</th>
            <th>Temp</th>
            <th>Load</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((index) => {
            const row = telemetryFor(index)
            const percent = props.percents[index] ?? 0
            return (
              <tr key={index} data-testid={`can-esc-row-${index}`}>
                <td>{index}</td>
                <td className="can-actuators__slider">
                  <input
                    type="range"
                    min={0}
                    max={props.limitPct}
                    step={0.5}
                    value={percent}
                    onChange={(event) => props.onPercent(index, Number(event.target.value))}
                    aria-label={`ESC ${index} throttle`}
                    data-testid={`can-esc-slider-${index}`}
                  />
                  <output>{percent.toFixed(1)}%</output>
                </td>
                <td data-testid={`can-esc-rpm-${index}`}>{row?.rpmLabel ?? '—'}</td>
                <td>{row?.voltageLabel ?? '—'}</td>
                <td>{row?.currentLabel ?? '—'}</td>
                <td>{row?.temperatureLabel ?? '—'}</td>
                <td>{row?.powerLabel ?? '—'}</td>
                <td>{row?.errorCountLabel ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="can-actuators__note">
        ESC settings (direction, pole count, telemetry rate) are the ESC node&apos;s parameters on Devices. With the autopilot on the bus, test
        motors from the Motors tab: it is the one commanding these ESCs.
      </p>
    </section>
  )
}

export interface CanServoToolViewProps extends SharedProps {
  type: ServoCommandType
  onType: (type: ServoCommandType) => void
  channels: readonly ServoChannel[]
  onValue: (index: number, value: number) => void
  onActuatorId: (index: number, actuatorId: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onCenter: () => void
  /** Last reported position per actuator id (uavcan.equipment.actuator.Status), when a node reports one. */
  positions: ReadonlyMap<number, number>
}

export function CanServoToolView(props: CanServoToolViewProps): ReactElement {
  const pwm = props.type === 'pwm'
  return (
    <section className="can-actuators" data-testid="can-servo-tool">
      <p className="can-actuators__lede">
        Drive DroneCAN servos straight from here. AP_Periph moves the output whose function is RCIN<em>n</em> for actuator <em>n</em>.
      </p>
      <RunBar {...props} tool="servo" />
      <div className="can-actuators__settings">
        <label>
          <span>Command</span>
          <select value={props.type} disabled={props.running} onChange={(event) => props.onType(event.target.value as ServoCommandType)} data-testid="can-servo-type">
            <option value="pwm">PWM (µs)</option>
            <option value="unitless">Normalised (−1 … 1)</option>
          </select>
        </label>
        <button type="button" style={buttonStyle()} onClick={props.onCenter} data-testid="can-servo-center">
          Center all
        </button>
        <button type="button" style={buttonStyle()} onClick={props.onAdd} disabled={props.channels.length >= 15} data-testid="can-servo-add">
          Add servo
        </button>
      </div>
      <table className="can-actuators__table">
        <thead>
          <tr>
            <th>Actuator</th>
            <th>Command</th>
            <th>Reported</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.channels.map((channel, index) => {
            const reported = props.positions.get(channel.actuatorId)
            return (
              <tr key={index} data-testid={`can-servo-row-${index}`}>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={255}
                    value={channel.actuatorId}
                    onChange={(event) => props.onActuatorId(index, Number(event.target.value))}
                    className="can-actuators__id"
                    aria-label={`Servo ${index + 1} actuator id`}
                    data-testid={`can-servo-id-${index}`}
                  />
                </td>
                <td className="can-actuators__slider">
                  <input
                    type="range"
                    min={pwm ? SERVO_PWM_MIN : -1}
                    max={pwm ? SERVO_PWM_MAX : 1}
                    step={pwm ? 1 : 0.01}
                    value={channel.value}
                    onChange={(event) => props.onValue(index, Number(event.target.value))}
                    aria-label={`Actuator ${channel.actuatorId} command`}
                    data-testid={`can-servo-slider-${index}`}
                  />
                  <output>{pwm ? `${channel.value} µs` : channel.value.toFixed(2)}</output>
                </td>
                <td>{reported !== undefined ? reported.toFixed(2) : '—'}</td>
                <td>
                  <button
                    type="button"
                    style={buttonStyle()}
                    disabled={props.channels.length <= 1}
                    onClick={() => props.onRemove(index)}
                    aria-label={`Remove actuator ${channel.actuatorId}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
