// Read-only ESC/DShot probe. Captures the boot banner across a reboot, because
// the RCOut line (the protocol the firmware ACTUALLY brought up) only prints then.
import { MavlinkSession, MavlinkV2Codec } from '@arduconfig/protocol-mavlink'
import { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { arducopterMetadata } from '@arduconfig/param-metadata'
import { NativeSerialTransport } from './apps/desktop/dist/native-serial-transport.js'

const transport = new NativeSerialTransport('hw', { path: process.argv[2], baudRate: 115200 })
const session = new MavlinkSession(transport, new MavlinkV2Codec(), { systemId: 255, componentId: 190 })
const banners = []
session.onMessage((e) => { const m = e.message ?? e; if (m?.type === 'STATUSTEXT') banners.push(m.text) })
const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
await runtime.connect()
const dl = Date.now() + 30000
while (Date.now() < dl && !runtime.getSnapshot().vehicle?.vehicle) await new Promise(r => setTimeout(r, 250))
await runtime.requestParameterList({ timeoutMs: 20000 })
await runtime.waitForParameterSync({ timeoutMs: 180000 })
const s = runtime.getSnapshot()
const has = (id) => s.parameters.some((x) => x.id === id)
const val = (id) => s.parameters.find((x) => x.id === id)?.value
const show = (id) => console.log(`  ${id.padEnd(20)} = ${has(id) ? val(id) : 'ABSENT'}`)

console.log(`vehicle: ${s.vehicle?.vehicle} | fw: ${s.hardware?.board?.firmwareVersion} | board id: ${s.hardware?.board?.boardType} | armed: ${s.vehicle?.armed} | params: ${s.parameterStats.total}`)
console.log('\nProtocol:')
;['MOT_PWM_TYPE','SERVO_DSHOT_RATE','SERVO_DSHOT_ESC'].forEach(show)
console.log('\nBLHeli / bidirectional DShot:')
;['SERVO_BLH_AUTO','SERVO_BLH_MASK','SERVO_BLH_OTYPE','SERVO_BLH_POLES','SERVO_BLH_TRATE','SERVO_BLH_BDMASK','SERVO_BLH_RVMASK','SERVO_BLH_3DMASK'].forEach(show)
console.log('\nAll SERVO_BLH_* actually reported by this board:')
console.log('  ' + (s.parameters.filter(p=>p.id.startsWith('SERVO_BLH')).map(p=>`${p.id}=${p.value}`).join('\n  ') || 'NONE'))
console.log(`\nESC telemetry (proves bdshot is really running): ${s.escTelemetry ? JSON.stringify(s.escTelemetry).slice(0,200) : 'none in snapshot'}`)

console.log('\nBanner so far:')
banners.filter(t=>/RCOut|ArduCopter|IMU|Frame|^[A-Z0-9_]{4,} [0-9A-F]{8}/.test(t)).forEach(t=>console.log('  '+t))
await runtime.disconnect()
process.exit(0)
