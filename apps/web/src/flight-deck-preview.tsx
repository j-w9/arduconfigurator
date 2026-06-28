import { useEffect, useMemo, useRef, useState } from 'react'

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

interface FlightDeckPreviewProps {
  rollDeg?: number
  pitchDeg?: number
  yawDeg?: number
  // True attitude quaternion (w, x, y, z) from ATTITUDE_QUATERNION. When
  // present the 3D model is oriented from this directly (singularity-free);
  // roll/pitch/yaw still drive the numeric readouts + heading tape.
  quaternion?: { w: number; x: number; y: number; z: number }
  flightMode?: string
  verified: boolean
  vehicleType?: string
  frameClassLabel?: string
  frameTypeLabel?: string
  // QuadPlane lift geometry (Q_FRAME_CLASS / Q_FRAME_TYPE values), used to draw
  // the right number/layout of lift rotors on QuadPlane + tiltrotor meshes.
  quadFrameClass?: number
  quadFrameType?: number
  compact?: boolean
  showReadouts?: boolean
  testId?: string
  // Overrides the caption's source line. Defaults to the FC-attitude wording;
  // the receiver stick preview passes its own (it's driven by sticks, not the
  // flight controller's attitude telemetry).
  captionLabel?: string
}

interface ModelSceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  modelWrapper: THREE.Group
  attitudeGroup: THREE.Group
  model?: THREE.Object3D
}

interface TelemetryState {
  attitudeQuaternion: THREE.Quaternion
  pitchVisual: number
  rollVisual: number
  headingDeg: number
}

interface TargetTelemetryState extends TelemetryState {}

interface CurrentTelemetryState extends TelemetryState {}

interface DisplayTelemetryState {
  pitchVisual: number
  rollVisual: number
  headingDeg: number
}

const HEADING_TAPE_WINDOW_DEGREES = 120
const HEADING_TAPE_STEP_DEGREES = 5
const PITCH_AXIS = new THREE.Vector3(1, 0, 0)
const ROLL_AXIS = new THREE.Vector3(0, 0, 1)
const YAW_AXIS = new THREE.Vector3(0, 1, 0)
// Flight assets are authored Y-up with the nose on -Z. Keep that level rest
// pose (identity mount) so the craft sits flat with its nose pointing away
// from the camera — a Betaflight-style chase view from behind the aircraft.
// Live roll/pitch/yaw are applied on the attitude group on top of this.
const MODEL_MOUNT_QUATERNION = new THREE.Quaternion()

function createTelemetryState(): TelemetryState {
  return {
    attitudeQuaternion: new THREE.Quaternion(),
    pitchVisual: 0,
    rollVisual: 0,
    headingDeg: 0
  }
}

function renderScene(state: ModelSceneState): void {
  state.renderer.render(state.scene, state.camera)
}

function shortestAngleDeltaDegrees(current: number, target: number): number {
  let delta = (target - current) % 360
  if (delta > 180) {
    delta -= 360
  } else if (delta < -180) {
    delta += 360
  }
  return delta
}

function approachLinear(current: number, target: number, factor: number): number {
  return current + (target - current) * factor
}

function approachWrappedDegrees(current: number, target: number, factor: number): number {
  return current + shortestAngleDeltaDegrees(current, target) * factor
}

function mountModel(
  state: ModelSceneState,
  model: THREE.Object3D,
  compact: boolean,
  scaleMode: 'betaflight' | 'fit' = 'fit',
  fitTargetSize?: number
): void {
  if (state.model) {
    state.attitudeGroup.remove(state.model)
  }

  if (scaleMode === 'betaflight') {
    model.scale.setScalar(compact ? 15 : 16.5)
    model.position.set(0, 0, 0)
  } else {
    const box = new THREE.Box3().setFromObject(model)
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    box.getCenter(center)
    box.getSize(size)

    model.position.sub(center)

    const maxDimension = Math.max(size.x, size.y, size.z, 1)
    // Smaller footprint so the craft doesn't dominate the panel (was 68/78,
    // then 58/66 — still read as too big, so down again to 48/54). Plane-family
    // models pass an explicit target so they read at the same footprint as the
    // betaflight-scaled GLTF copters.
    const targetSize = fitTargetSize ?? (compact ? 48 : 54)
    const scale = targetSize / maxDimension
    model.scale.setScalar(scale)
  }

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return
    }

    object.castShadow = false
    object.receiveShadow = false

    if (Array.isArray(object.material)) {
      object.material.forEach((material) => {
        material.side = THREE.FrontSide
      })
      return
    }

    object.material.side = THREE.FrontSide
  })

  state.model = model
  state.attitudeGroup.add(model)
  renderScene(state)
}

function createArm(length: number, headingRad: number): THREE.Mesh {
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, length, 18),
    new THREE.MeshStandardMaterial({ color: 0x182435, metalness: 0.35, roughness: 0.55 })
  )
  arm.rotation.z = Math.PI / 2
  arm.rotation.y = headingRad
  arm.position.set(Math.cos(headingRad) * (length / 2), 0, Math.sin(headingRad) * (length / 2))
  return arm
}

function createMotor(x: number, z: number, accentColor: number): THREE.Group {
  const motor = new THREE.Group()
  motor.position.set(x, 0, z)

  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.24, 24),
    new THREE.MeshStandardMaterial({ color: 0x111821, metalness: 0.5, roughness: 0.36 })
  )
  can.position.y = 0.16
  motor.add(can)

  const propRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.64, 0.04, 10, 36),
    new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.1, roughness: 0.45 })
  )
  propRing.rotation.x = Math.PI / 2
  propRing.position.y = 0.24
  motor.add(propRing)

  return motor
}

// Evenly spaced motors around a ring, starting at `startDeg` (clockwise from
// the nose). Used for the higher-motor-count frame classes that don't have a
// bespoke gltf model.
function ringLayout(count: number, radius: number, startDeg: number): Array<{ x: number; z: number }> {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = ((startDeg + (360 / count) * index) * Math.PI) / 180
    return { x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius }
  })
}

function motorLayoutForModel(modelFile: string): Array<{ x: number; z: number }> {
  switch (modelFile) {
    case 'quad_plus':
      return [
        { x: 0, z: -2.2 },
        { x: 2.2, z: 0 },
        { x: 0, z: 2.2 },
        { x: -2.2, z: 0 }
      ]
    case 'octa_x':
      return ringLayout(8, 2.4, 22.5)
    case 'octa_plus':
      return ringLayout(8, 2.4, 0)
    case 'deca':
      return ringLayout(10, 2.5, 18)
    case 'dodeca_hexa':
      return ringLayout(12, 2.6, 15)
    case 'tricopter':
      return [
        { x: 0, z: -2.15 },
        { x: -1.95, z: 1.45 },
        { x: 1.95, z: 1.45 }
      ]
    case 'hex_plus':
      return [
        { x: 0, z: -2.35 },
        { x: 2.05, z: -1.05 },
        { x: 2.05, z: 1.05 },
        { x: 0, z: 2.35 },
        { x: -2.05, z: 1.05 },
        { x: -2.05, z: -1.05 }
      ]
    case 'hex_x':
    case 'y6':
      return [
        { x: 1.95, z: -1.15 },
        { x: 2.15, z: 1.1 },
        { x: 0, z: 2.35 },
        { x: -1.95, z: 1.15 },
        { x: -2.15, z: -1.1 },
        { x: 0, z: -2.35 }
      ]
    case 'quad_x':
    default:
      return [
        { x: -1.75, z: -1.75 },
        { x: 1.75, z: -1.75 },
        { x: -1.75, z: 1.75 },
        { x: 1.75, z: 1.75 }
      ]
  }
}

// Forward is -Z, up is +Y, span is X — matching the copter models. A rounded
// fuselage + cone nose + canopy reads more like an aircraft than the old box
// stack; the QuadPlane / tiltrotor variants build their lift hardware on top.
function createPlaneModel(): THREE.Group {
  const plane = new THREE.Group()

  const airframe = new THREE.MeshStandardMaterial({ color: 0xd8e3f3, metalness: 0.18, roughness: 0.56 })
  const accent = new THREE.MeshStandardMaterial({ color: 0x61dafb, metalness: 0.12, roughness: 0.4 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a2330, metalness: 0.24, roughness: 0.42 })

  // Rounded fuselage running fore-aft (cylinder axis rotated onto Z).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 3.0, 20), airframe)
  fuselage.rotation.x = Math.PI / 2
  plane.add(fuselage)

  // Tractor nose cone.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 20), accent)
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 0, -1.85)
  plane.add(nose)

  // Canopy (a flattened, stretched dome).
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark)
  canopy.scale.set(1, 0.7, 1.7)
  canopy.position.set(0, 0.13, -0.6)
  plane.add(canopy)

  const wing = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.06, 0.82), airframe)
  wing.position.set(0, 0.02, -0.1)
  plane.add(wing)

  const hStab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.5), airframe)
  hStab.position.set(0, 0.02, 1.4)
  plane.add(hStab)

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.55), airframe)
  fin.position.set(0, 0.3, 1.42)
  plane.add(fin)

  return plane
}

type LiftLayout = ReadonlyArray<{ x: number; z: number }>

// Map the QuadPlane lift geometry (Q_FRAME_CLASS / Q_FRAME_TYPE) onto the same
// rotor layouts the copter models use, so the mesh shows the right number of
// lift rotors in the right arrangement (quad/hexa/octa/Y6/tri, X vs +).
function quadplaneLiftLayout(qFrameClass: number | undefined, qFrameType: number | undefined): LiftLayout {
  const isPlus = qFrameType === 0 // ARDUPLANE_Q_FRAME_TYPE: 0 = Plus, 1 = X
  let key: string
  switch (qFrameClass) {
    case 2:
      key = isPlus ? 'hex_plus' : 'hex_x' // Hexa
      break
    case 3:
    case 4:
      key = isPlus ? 'octa_plus' : 'octa_x' // Octa / OctaQuad
      break
    case 5:
      key = 'y6' // Y6
      break
    case 7:
      key = 'tricopter' // Tri
      break
    default:
      key = isPlus ? 'quad_plus' : 'quad_x' // Quad (and unknown)
  }
  return motorLayoutForModel(key)
}

// QuadPlane: the fixed-wing airframe plus the multirotor lift frame implied by
// Q_FRAME_CLASS/Q_FRAME_TYPE — arms + horizontal lift rotors straddling the body.
function createQuadPlaneModel(liftLayout: LiftLayout): THREE.Group {
  const craft = createPlaneModel()
  liftLayout.forEach(({ x, z }, index) => {
    craft.add(createArm(Math.hypot(x, z), Math.atan2(z, x)))
    craft.add(createMotor(x, z, index % 2 === 0 ? 0x61dafb : 0xff815f))
  })
  return craft
}

// Tiltrotor: the same lift frame, but the rotors tilt forward to read as
// tilting nacelles rather than fixed lift rotors.
function createTiltrotorModel(liftLayout: LiftLayout): THREE.Group {
  const craft = createPlaneModel()
  const tiltForward = -Math.PI / 2.4
  liftLayout.forEach(({ x, z }, index) => {
    craft.add(createArm(Math.hypot(x, z), Math.atan2(z, x)))
    const motor = createMotor(x, z, index % 2 === 0 ? 0x61dafb : 0xff815f)
    motor.rotation.x = tiltForward
    craft.add(motor)
  })
  return craft
}

function createBoxGroup(
  parts: ReadonlyArray<readonly [number, number, number, number, number, number]>,
  bodyColor: number,
  accentColor: number,
  accentFrom: number
): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.28, roughness: 0.5 })
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.18, roughness: 0.42 })
  parts.forEach(([w, h, d, x, y, z], index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), index >= accentFrom ? accent : body)
    mesh.position.set(x, y, z)
    group.add(mesh)
  })
  return group
}

// Box geometry mirrors scripts/generate-rover-gltf.mjs (full extents =
// 2x the script's half-extents) so the procedural fallback matches the
// loaded asset. [w, h, d, x, y, z]
function createRoverModel(): THREE.Group {
  return createBoxGroup(
    [
      [1.24, 0.44, 3.7, 0, 0.06, 0], // chassis
      [1.0, 0.28, 1.7, 0, 0.34, -0.2], // electronics deck
      [0.68, 0.24, 0.52, 0, 0.2, -1.55], // front bumper
      [0.08, 0.52, 0.08, 0, 0.62, 0.05], // GPS / comms mast
      [0.32, 0.84, 1.0, -0.86, -0.02, 1.45], // rear-left wheel
      [0.32, 0.84, 1.0, 0.86, -0.02, 1.45], // rear-right wheel
      [0.32, 0.84, 1.0, -0.86, -0.02, -1.45], // front-left wheel
      [0.32, 0.84, 1.0, 0.86, -0.02, -1.45] // front-right wheel
    ],
    0x969faf,
    0x2b3340,
    4
  )
}

// Box geometry mirrors scripts/generate-sub-gltf.mjs.
function createSubModel(): THREE.Group {
  return createBoxGroup(
    [
      [1.1, 0.92, 3.1, 0, 0, 0], // pressure hull
      [1.6, 0.36, 3.56, 0, 0.58, 0], // buoyancy block
      [0.1, 0.68, 2.9, -0.78, 0, 0], // left frame rail
      [0.1, 0.68, 2.9, 0.78, 0, 0], // right frame rail
      [0.4, 0.4, 0.64, -0.66, -0.04, 1.55], // rear-left thruster
      [0.4, 0.4, 0.64, 0.66, -0.04, 1.55], // rear-right thruster
      [0.4, 0.4, 0.6, -0.92, 0.06, -0.55], // forward-left vectored thruster
      [0.4, 0.4, 0.6, 0.92, 0.06, -0.55], // forward-right vectored thruster
      [0.32, 0.24, 0.32, -0.42, 0.42, 0.1], // left vertical thruster
      [0.32, 0.24, 0.32, 0.42, 0.42, 0.1] // right vertical thruster
    ],
    0x73b8cc,
    0x1a2330,
    4
  )
}

function createProceduralModel(modelFile: string, liftLayout: LiftLayout = []): THREE.Group {
  // 'bixler' / 'alti' are real GLTF meshes; these procedural builds are only the
  // graceful fallback if the asset fails to load.
  if (modelFile === 'plane' || modelFile === 'bixler') {
    return createPlaneModel()
  }
  if (modelFile === 'quadplane') {
    return createQuadPlaneModel(liftLayout)
  }
  if (modelFile === 'tiltrotor' || modelFile === 'alti') {
    return createTiltrotorModel(liftLayout)
  }
  if (modelFile === 'rover') {
    return createRoverModel()
  }
  if (modelFile === 'sub') {
    return createSubModel()
  }

  const craft = new THREE.Group()

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.34, 1.45),
    new THREE.MeshStandardMaterial({ color: 0xd8e3f3, metalness: 0.18, roughness: 0.56 })
  )
  body.position.y = 0.08
  craft.add(body)

  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.12, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x0f1722, metalness: 0.3, roughness: 0.5 })
  )
  topPlate.position.y = 0.33
  craft.add(topPlate)

  const stack = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.16, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x61dafb, metalness: 0.12, roughness: 0.38 })
  )
  stack.position.y = 0.48
  craft.add(stack)

  const motorPositions = motorLayoutForModel(modelFile)
  motorPositions.forEach(({ x, z }, index) => {
    const heading = Math.atan2(z, x)
    const length = Math.hypot(x, z)
    craft.add(createArm(length, heading))
    craft.add(createMotor(x, z, index % 2 === 0 ? 0x61dafb : 0xff815f))
  })

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.56, 3),
    new THREE.MeshStandardMaterial({ color: 0xff815f, metalness: 0.08, roughness: 0.32 })
  )
  nose.rotation.z = Math.PI / 2
  nose.position.set(0, 0.18, -1.08)
  craft.add(nose)

  const cameraPod = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.28, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x1a2330, metalness: 0.24, roughness: 0.42 })
  )
  cameraPod.position.set(0, 0.18, -0.76)
  craft.add(cameraPod)

  return craft
}

function clampDegrees(value: number | undefined, limit: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0
  }

  return Math.max(-limit, Math.min(limit, value))
}

function normalizeHeading(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0
  }

  const normalized = value % 360
  return normalized >= 0 ? normalized : normalized + 360
}

function offsetHeading(value: number | undefined, offsetDeg: number): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined
  }

  return normalizeHeading(value - offsetDeg)
}

function modelFileForAirframe(
  frameClassLabel: string | undefined,
  frameTypeLabel: string | undefined,
  vehicleType: string | undefined
): string {
  // Non-copter vehicles have no copter "frame class"; key off the vehicle
  // so they never fall through to the quad default.
  const vehicle = (vehicleType ?? '').toLowerCase()
  if (vehicle.includes('plane')) {
    // Real upstream aircraft meshes (ArduPilot/ArduConfigurator, public domain):
    // a Bixler for fixed-wing, an Alti Transition for any VTOL subtype. The
    // airframe label resolves the subtype (QuadPlane / Tiltrotor / Tailsitter).
    const planeClass = frameClassLabel?.toLowerCase() ?? ''
    const isVtol =
      planeClass.includes('quadplane') || planeClass.includes('tiltrotor') || planeClass.includes('tailsitter')
    return isVtol ? 'alti' : 'bixler'
  }
  if (vehicle.includes('rover') || vehicle.includes('boat')) {
    return 'rover'
  }
  if (vehicle.includes('sub')) {
    return 'sub'
  }

  const frameClass = frameClassLabel?.toLowerCase() ?? ''
  const frameType = frameTypeLabel?.toLowerCase() ?? ''

  if (frameClass.includes('tricopter') || frameClass.includes('tri')) {
    return 'tricopter'
  }

  if (frameClass.includes('y6')) {
    return 'y6'
  }

  const isPlus = frameType.includes('+') || frameType.includes('plus')

  // Check the larger frame classes before 'quad' so OctaQuad doesn't match
  // the 'quad' substring and render as a 4-motor quad.
  if (frameClass.includes('dodeca')) {
    return 'dodeca_hexa'
  }

  if (frameClass.includes('deca')) {
    return 'deca'
  }

  if (frameClass.includes('octa')) {
    // Octa + OctaQuad both have 8 motors; show an 8-motor layout.
    return isPlus ? 'octa_plus' : 'octa_x'
  }

  if (frameClass.includes('hex')) {
    return isPlus ? 'hex_plus' : 'hex_x'
  }

  if (frameClass.includes('quad')) {
    return isPlus ? 'quad_plus' : 'quad_x'
  }

  return 'quad_x'
}

function formatDegrees(value: number | undefined): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(1)}°`
}

function formatHeadingValue(value: number): string {
  return `${Math.round(normalizeHeading(value))}`.padStart(3, '0')
}

function formatHeadingTapeLabel(value: number): string {
  const normalized = normalizeHeading(value)
  if (normalized === 0) {
    return 'N'
  }
  if (normalized === 90) {
    return 'E'
  }
  if (normalized === 180) {
    return 'S'
  }
  if (normalized === 270) {
    return 'W'
  }
  return `${Math.round(normalized)}`.padStart(3, '0')
}

function headingTapeLabelTone(value: number): 'north' | 'cardinal' | 'numeric' {
  const normalized = normalizeHeading(value)
  if (normalized === 0) {
    return 'north'
  }
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return 'cardinal'
  }
  return 'numeric'
}

const DEG2RAD = Math.PI / 180

// Change of basis from the flight controller's NED body frame to the scene
// frame: NED north (forward) -> scene -Z (nose), NED east (right) -> scene +X,
// NED down -> scene -Y. Used to map the FC attitude quaternion into the scene
// without ever going through Euler angles.
const NED_TO_SCENE_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, -1, 0)
  )
)
const NED_TO_SCENE_QUATERNION_INVERSE = NED_TO_SCENE_QUATERNION.clone().invert()

// Scene-frame attitude from aerospace Euler (radians), unclamped. Shared by the
// Euler fallback below and the equivalence unit test.
export function buildVisualQuaternionFromEulerRad(
  rollRad: number,
  pitchRad: number,
  yawRad: number
): THREE.Quaternion {
  const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(YAW_AXIS, -yawRad)
  const pitchQuaternion = new THREE.Quaternion().setFromAxisAngle(PITCH_AXIS, pitchRad)
  const rollQuaternion = new THREE.Quaternion().setFromAxisAngle(ROLL_AXIS, -rollRad)
  return yawQuaternion.multiply(pitchQuaternion).multiply(rollQuaternion)
}

// Euler fallback (used when ATTITUDE_QUATERNION isn't available). Clamped to
// ±70° so the noisy near-vertical Euler the FC derives can't throw the model
// around — the quaternion-sourced path is unclamped and singularity-free.
function buildAttitudeQuaternion(rollDeg: number | undefined, pitchDeg: number | undefined, yawDeg: number | undefined): THREE.Quaternion {
  return buildVisualQuaternionFromEulerRad(
    clampDegrees(rollDeg, 70) * DEG2RAD,
    clampDegrees(pitchDeg, 70) * DEG2RAD,
    normalizeHeading(yawDeg) * DEG2RAD
  )
}

// True FC attitude quaternion (w, x, y, z; body->NED) mapped into the scene
// frame. No Euler intermediate, so it stays smooth at any attitude. The heading
// offset matches the bench heading trim applied on the Euler path.
export function buildVisualQuaternionFromFc(
  quaternion: { w: number; x: number; y: number; z: number },
  headingOffsetDeg = 0
): THREE.Quaternion {
  // THREE.Quaternion is (x, y, z, w); the FC sends (w, x, y, z).
  const fc = new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  const visual = NED_TO_SCENE_QUATERNION.clone()
    .multiply(fc)
    .multiply(NED_TO_SCENE_QUATERNION_INVERSE)
  if (headingOffsetDeg) {
    return new THREE.Quaternion().setFromAxisAngle(YAW_AXIS, headingOffsetDeg * DEG2RAD).multiply(visual)
  }
  return visual
}

function buildHeadingTapeMarks(headingDeg: number): Array<{
  value: number
  leftPercent: number
  major: boolean
  label?: string
  tone: 'north' | 'cardinal' | 'numeric'
}> {
  const halfWindow = HEADING_TAPE_WINDOW_DEGREES / 2

  return Array.from({ length: 360 / HEADING_TAPE_STEP_DEGREES }, (_, index) => index * HEADING_TAPE_STEP_DEGREES)
    .map((value) => {
      const delta = shortestAngleDeltaDegrees(headingDeg, value)
      return { value, delta }
    })
    .filter((mark) => Math.abs(mark.delta) <= halfWindow)
    .sort((left, right) => left.delta - right.delta)
    .map((mark) => ({
      value: mark.value,
      leftPercent: 50 + (mark.delta / halfWindow) * 50,
      major: mark.value % 10 === 0,
      label: mark.value % 30 === 0 ? formatHeadingTapeLabel(mark.value) : undefined,
      tone: headingTapeLabelTone(mark.value)
    }))
}

export function FlightDeckPreview({
  rollDeg,
  pitchDeg,
  yawDeg,
  quaternion,
  flightMode,
  verified,
  vehicleType,
  frameClassLabel,
  frameTypeLabel,
  quadFrameClass,
  quadFrameType,
  compact = false,
  showReadouts = true,
  testId,
  captionLabel
}: FlightDeckPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const sceneStateRef = useRef<ModelSceneState | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const loaderRef = useRef<GLTFLoader | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const previousAnimationTimeRef = useRef<number | null>(null)
  const targetTelemetryRef = useRef<TargetTelemetryState>(createTelemetryState())
  const currentTelemetryRef = useRef<CurrentTelemetryState>(createTelemetryState())
  const telemetryInitializedRef = useRef(false)
  const uiUpdateTimeRef = useRef(0)
  const [benchHeadingOffsetDeg, setBenchHeadingOffsetDeg] = useState<number | null>(null)
  const [displayTelemetry, setDisplayTelemetry] = useState<DisplayTelemetryState>({
    pitchVisual: 0,
    rollVisual: 0,
    headingDeg: 0
  })

  const modelFile = useMemo(
    () => modelFileForAirframe(frameClassLabel, frameTypeLabel, vehicleType),
    [frameClassLabel, frameTypeLabel, vehicleType]
  )

  // Lift-rotor layout for the QuadPlane / tiltrotor meshes, derived from the
  // QuadPlane frame geometry so the rotor count + arrangement track the FC.
  const liftLayout = useMemo<LiftLayout>(
    () =>
      modelFile === 'quadplane' || modelFile === 'tiltrotor' || modelFile === 'alti'
        ? quadplaneLiftLayout(quadFrameClass, quadFrameType)
        : [],
    [modelFile, quadFrameClass, quadFrameType]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) {
      return
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    // Slightly narrowed FOV (vs the old 60) tones down the near-motor
    // looming for a flatter, Betaflight-like perspective without shrinking
    // the craft in the panel.
    const camera = new THREE.PerspectiveCamera(52, 1, 1, 10000)
    // Betaflight-style chase view: camera sits behind the craft (+Z) and only
    // slightly above (low elevation ≈ 17°, was ~28°), looking forward toward
    // the nose (-Z). The aircraft points away from the viewer (forward) and
    // sits nearly flat at rest — a low rear-on view like Betaflight's setup,
    // not a steep top-down. Roll banks left/right and pitch dips the nose away.
    camera.position.set(0, 40, 132)
    camera.lookAt(0, 2, 0)

    const modelWrapper = new THREE.Group()
    modelWrapper.quaternion.copy(MODEL_MOUNT_QUATERNION)
    const attitudeGroup = new THREE.Group()
    modelWrapper.add(attitudeGroup)
    scene.add(camera)
    scene.add(modelWrapper)

    const ambient = new THREE.AmbientLight(0x565656, 1.05)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.65)
    keyLight.position.set(0.12, 1, 0.28)
    const fillLight = new THREE.DirectionalLight(0xa9bcc9, 0.78)
    fillLight.position.set(-0.55, 0.38, 1)
    const rimLight = new THREE.DirectionalLight(0x5f7486, 0.42)
    rimLight.position.set(0, -0.3, -1)

    scene.add(ambient)
    scene.add(keyLight)
    scene.add(fillLight)
    scene.add(rimLight)

    sceneStateRef.current = { renderer, scene, camera, modelWrapper, attitudeGroup }
    loaderRef.current = new GLTFLoader()

    const resize = () => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      if (!width || !height || !sceneStateRef.current) {
        return
      }

      sceneStateRef.current.renderer.setSize(width, height, false)
      sceneStateRef.current.camera.aspect = width / height
      sceneStateRef.current.camera.updateProjectionMatrix()
      renderScene(sceneStateRef.current)
    }

    resize()

    const observer = new ResizeObserver(() => resize())
    observer.observe(viewport)
    resizeObserverRef.current = observer

    const animate = (now: number) => {
      animationFrameRef.current = window.requestAnimationFrame(animate)

      const state = sceneStateRef.current
      if (!state) {
        return
      }

      const previousTime = previousAnimationTimeRef.current ?? now
      previousAnimationTimeRef.current = now
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05)
      // Time constant for the slerp / linear catch-up toward the latest
      // target attitude. Higher = snappier model, more sensor-noise
      // transparency. 10 was visibly laggy on a real Cube — the model
      // reached 99% of a stick input in ~500 ms, which feels stale at
      // 40 Hz ATTITUDE telemetry. 25 lands at ~200 ms which tracks the
      // bench operator's actual motion without amplifying gyro jitter.
      const interpolationFactor = 1 - Math.exp(-deltaSeconds * 25)

      const target = targetTelemetryRef.current
      const current = currentTelemetryRef.current

      current.attitudeQuaternion.slerp(target.attitudeQuaternion, interpolationFactor)
      current.pitchVisual = approachLinear(current.pitchVisual, target.pitchVisual, interpolationFactor)
      current.rollVisual = approachLinear(current.rollVisual, target.rollVisual, interpolationFactor)
      current.headingDeg = approachWrappedDegrees(current.headingDeg, target.headingDeg, interpolationFactor)

      state.attitudeGroup.quaternion.copy(current.attitudeQuaternion)

      renderScene(state)

      if (now - uiUpdateTimeRef.current >= 33) {
        uiUpdateTimeRef.current = now
        setDisplayTelemetry({
          pitchVisual: current.pitchVisual,
          rollVisual: current.rollVisual,
          headingDeg: current.headingDeg
        })
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(animate)

    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      previousAnimationTimeRef.current = null
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      const state = sceneStateRef.current
      if (state?.model) {
        state.attitudeGroup.remove(state.model)
      }
      state?.renderer.dispose()
      sceneStateRef.current = null
      loaderRef.current = null
    }
  }, [])

  useEffect(() => {
    const state = sceneStateRef.current
    const loader = loaderRef.current
    if (!state || !loader) {
      return
    }

    const modelUrl = `${import.meta.env.BASE_URL}models/${modelFile}.gltf`
    let cancelled = false

    // Plane-family craft (fixed-wing GLTF + the procedural QuadPlane/tiltrotor)
    // are natively ~half the quad GLTF's width, so the betaflight scalar / the
    // default fit target rendered them much smaller than the copter. Fit them to
    // the quad's on-screen footprint: quad_x.gltf is 8.22 native units, so match
    // that world size at the betaflight scalar.
    const planeFamily =
      modelFile === 'bixler' ||
      modelFile === 'alti' ||
      modelFile === 'plane' ||
      modelFile === 'quadplane' ||
      modelFile === 'tiltrotor'
    // 1.15x the quad footprint — planes read a touch small at parity given the
    // thin fuselage, so nudge them slightly larger than the copter.
    const planeFitTarget = 8.22 * (compact ? 15 : 16.5) * 1.15

    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled || !sceneStateRef.current) {
          return
        }

        if (planeFamily) {
          mountModel(state, gltf.scene, compact, 'fit', planeFitTarget)
        } else {
          mountModel(state, gltf.scene, compact, 'betaflight')
        }
      },
      undefined,
      () => {
        if (!sceneStateRef.current) {
          return
        }
        if (planeFamily) {
          mountModel(state, createProceduralModel(modelFile, liftLayout), compact, 'fit', planeFitTarget)
        } else {
          mountModel(state, createProceduralModel(modelFile), compact, 'fit')
        }
      }
    )

    return () => {
      cancelled = true
    }
  }, [compact, modelFile, liftLayout])

  useEffect(() => {
    const headingOffsetDeg = benchHeadingOffsetDeg ?? 0
    const adjustedYawDeg = offsetHeading(yawDeg, headingOffsetDeg)
    const nextTelemetry = {
      // Prefer the FC's true quaternion (no Euler singularity); fall back to the
      // clamped Euler build when ATTITUDE_QUATERNION hasn't arrived.
      attitudeQuaternion: quaternion
        ? buildVisualQuaternionFromFc(quaternion, headingOffsetDeg)
        : buildAttitudeQuaternion(rollDeg, pitchDeg, adjustedYawDeg),
      pitchVisual: clampDegrees(pitchDeg, 28),
      rollVisual: clampDegrees(rollDeg, 50),
      headingDeg: normalizeHeading(adjustedYawDeg)
    }

    targetTelemetryRef.current = {
      attitudeQuaternion: nextTelemetry.attitudeQuaternion.clone(),
      pitchVisual: nextTelemetry.pitchVisual,
      rollVisual: nextTelemetry.rollVisual,
      headingDeg: nextTelemetry.headingDeg
    }

    if (!telemetryInitializedRef.current) {
      currentTelemetryRef.current = {
        attitudeQuaternion: nextTelemetry.attitudeQuaternion.clone(),
        pitchVisual: nextTelemetry.pitchVisual,
        rollVisual: nextTelemetry.rollVisual,
        headingDeg: nextTelemetry.headingDeg
      }
      telemetryInitializedRef.current = true
      setDisplayTelemetry({
        pitchVisual: nextTelemetry.pitchVisual,
        rollVisual: nextTelemetry.rollVisual,
        headingDeg: nextTelemetry.headingDeg
      })
    }
  }, [benchHeadingOffsetDeg, pitchDeg, rollDeg, yawDeg, quaternion])

  const heading = normalizeHeading(displayTelemetry.headingDeg)
  const headingTapeMarks = useMemo(() => buildHeadingTapeMarks(heading), [heading])
  const digitalHeading = formatHeadingValue(heading)
  const headingStatusLabel = benchHeadingOffsetDeg === null ? 'Absolute heading' : 'Bench-forward zeroed'

  function handleSetBenchForward(): void {
    const sourceHeading = yawDeg !== undefined && !Number.isNaN(yawDeg) ? normalizeHeading(yawDeg) : normalizeHeading(displayTelemetry.headingDeg)
    setBenchHeadingOffsetDeg(sourceHeading)
  }

  function handleClearBenchForward(): void {
    setBenchHeadingOffsetDeg(null)
  }

  return (
    <div
      className={`flight-deck${compact ? ' flight-deck--compact' : ''}`}
      data-testid={testId}
      data-craft-model={modelFile}
    >
      <div className="flight-deck__model-shell">
        <div className={`flight-deck__model-frame${!verified ? ' is-standby' : ''}`} ref={viewportRef}>
          <canvas ref={canvasRef} className="flight-deck__canvas" />
          <div className="flight-deck__heading-tape" aria-hidden="true">
            <div className="flight-deck__heading-window">
              <div className="flight-deck__heading-ruler">
                {headingTapeMarks.map((mark) => (
                  <div
                    key={mark.value}
                    className={`flight-deck__heading-mark${mark.major ? ' is-major' : ''}${mark.tone === 'north' ? ' is-north' : mark.tone === 'cardinal' ? ' is-cardinal' : ''}`}
                    style={{ left: `${mark.leftPercent}%` }}
                  >
                    <span className="flight-deck__heading-mark-tick" />
                    {mark.label ? <span className="flight-deck__heading-mark-label">{mark.label}</span> : null}
                  </div>
                ))}
              </div>
              <div className="flight-deck__heading-cursor">
                <span>{digitalHeading}°</span>
              </div>
            </div>
          </div>
          <div className="flight-deck__reticle" aria-hidden="true">
            <span className="flight-deck__reticle-wing flight-deck__reticle-wing--left" />
            <span className="flight-deck__reticle-core" />
            <span className="flight-deck__reticle-wing flight-deck__reticle-wing--right" />
          </div>
          {!verified ? (
            <div className="flight-deck__standby">
              <strong>Preview staged</strong>
              <span>Attitude stream offline</span>
            </div>
          ) : null}
          {verified ? (
            <div className="flight-deck__hud">
              <span>ROLL {formatDegrees(rollDeg)}</span>
              <span>PITCH {formatDegrees(pitchDeg)}</span>
              <span>HDG {formatDegrees(heading)}</span>
            </div>
          ) : null}
        </div>
        <div className="flight-deck__caption">
          <div className="flight-deck__caption-copy">
            {captionLabel === '' ? null : (
              <span>{captionLabel ?? (verified ? 'Live attitude + heading from the flight controller' : 'Preview waiting on attitude telemetry')}</span>
            )}
            <strong>{flightMode ?? 'No active mode'}</strong>
          </div>
          <div className="flight-deck__caption-actions">
            <span className={`flight-deck__heading-reference${benchHeadingOffsetDeg !== null ? ' is-relative' : ''}`}>{headingStatusLabel}</span>
            <div className="flight-deck__heading-actions">
              <button
                type="button"
                className="flight-deck__heading-button"
                disabled={!verified}
                onClick={handleSetBenchForward}
                data-testid="flight-deck-zero-heading-button"
              >
                Set Bench Forward
              </button>
              {benchHeadingOffsetDeg !== null ? (
                <button
                  type="button"
                  className="flight-deck__heading-button is-secondary"
                  onClick={handleClearBenchForward}
                  data-testid="flight-deck-clear-heading-button"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {showReadouts ? (
          <div className="flight-deck__readout-grid">
            <article className={`flight-deck__readout-card${verified ? ' is-live' : ''}`}>
              <span>Roll</span>
              <strong>{formatDegrees(rollDeg)}</strong>
              <small>Live bank attitude from the 3D craft view.</small>
            </article>
            <article className={`flight-deck__readout-card${verified ? ' is-live' : ''}`}>
              <span>Pitch</span>
              <strong>{formatDegrees(pitchDeg)}</strong>
              <small>Forward / aft tilt with quaternion interpolation.</small>
            </article>
            <article className={`flight-deck__readout-card${verified ? ' is-live' : ''}`}>
              <span>Heading</span>
              <strong>{Math.round(heading)}°</strong>
              <small>{benchHeadingOffsetDeg === null ? 'Centered on the HUD heading tape.' : 'Relative to the saved bench-forward heading.'}</small>
            </article>
            <article className={`flight-deck__readout-card${verified ? ' is-live' : ''}`}>
              <span>Link State</span>
              <strong>{verified ? 'Synced' : 'Waiting'}</strong>
              <small>{verified ? 'ATTITUDE stream active.' : 'Preview is holding the staged pose.'}</small>
            </article>
          </div>
        ) : null}
      </div>
    </div>
  )
}
