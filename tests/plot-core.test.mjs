import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAVGRAPHS,
  SUPPORTED_FUNCTIONS,
  collectFunctions,
  collectReferences,
  createGraphEvaluator,
  createTermEvaluator,
  dataflashFieldIndex,
  evaluate,
  evaluateOnDataflash,
  graphTree,
  parseExpression,
  parseFormula,
  parseTerm,
  resolveGraph,
  searchGraphs,
  seriesFromField,
  termFunctions
} from '../packages/plot-core/dist/index.js'

const noMessages = { message: () => undefined }

function value(text, env = noMessages) {
  const parsed = parseFormula(text)
  assert.ok(parsed.ok, `${text} should parse`)
  return evaluate(parsed.ast, env)
}

function term(text) {
  const parsed = parseTerm(text)
  assert.ok(parsed.ok, `${text} should parse: ${parsed.ok ? '' : parsed.error.message}`)
  return parsed.term
}

// --- parser ------------------------------------------------------------------

test('arithmetic precedence follows Python', () => {
  assert.equal(value('1+2*3'), 7)
  assert.equal(value('(1+2)*3'), 9)
  assert.equal(value('10-4-3'), 3)
  assert.equal(value('2**3**2'), 512, '** is right-associative')
  assert.equal(value('-2**2'), -4, 'unary minus binds looser than **')
  assert.equal(value('2**-1'), 0.5, '** takes a unary operand on its right')
  assert.equal(value('-3*-2'), 6)
  assert.equal(value('7%3'), 1)
  assert.equal(value('-7%3'), 2, 'Python modulo sign follows the divisor')
  assert.equal(value('7//2'), 3)
  assert.equal(value('1.0e-6*1e6'), 1)
  assert.equal(value('1<2'), 1)
  assert.equal(value('2==3'), 0)
  assert.equal(value('1+1==2'), 1, 'comparison binds looser than +')
  assert.equal(value('6&(1<<2)'), 4)
  assert.equal(value('1 and 0 or 5'), 5)
  assert.equal(value('not 0'), 1)
  assert.equal(value('1/0'), undefined, 'division by zero is no value, not Infinity')
})

test('references: fields, instances, bare messages, function vectors', () => {
  const parsed = parseFormula('GPS[1].Spd*sin(radians(GPS.GCrs))+mag_heading(RAW_IMU,ATTITUDE)+expected_mag(GPS,NKF2[0]).x')
  assert.ok(parsed.ok)
  assert.deepEqual(collectReferences(parsed.ast), [
    { message: 'GPS', instance: 1, field: 'Spd' },
    { message: 'GPS', field: 'GCrs' },
    { message: 'RAW_IMU' },
    { message: 'ATTITUDE' },
    { message: 'GPS' },
    { message: 'NKF2', instance: 0 }
  ])
  assert.deepEqual(collectFunctions(parsed.ast).sort(), ['expected_mag', 'mag_heading', 'radians', 'sin'])
})

test('term suffixes: second axis, condition, custom label', () => {
  const t = term('BARO.Temp:2')
  assert.equal(t.axis, 2)
  assert.equal(t.label, 'BARO.Temp')
  assert.equal(t.condition, undefined)

  const c = term('NKF1[0].PD-NKF1[100].PD{NKF1.C==100}')
  assert.equal(c.axis, 1)
  assert.ok(c.condition)
  assert.equal(c.ast.kind, 'binary')

  const both = term('GPS2.Alt-GPS.Alt{GPS2.GMS==GPS.GMS}:2')
  assert.equal(both.axis, 2)
  assert.ok(both.condition)

  const labelled = term('ATT.Roll<Roll angle>')
  assert.equal(labelled.label, 'Roll angle')
  assert.equal(labelled.ast.kind, 'attr')

  const expr = parseExpression('  degrees(ATTITUDE.roll)   ATT.Pitch:2 ')
  assert.equal(expr.terms.length, 2)
  assert.deepEqual(expr.terms.map((x) => x.axis), [1, 2])
})

test('parse errors are returned, never thrown', () => {
  for (const bad of ['', 'ATT.', '(1+2', 'lowpass(IMU[1].AccX),1,0.9)', 'a $ b', '"open', '1 2', 'ATT.Roll{']) {
    const parsed = parseTerm(bad)
    assert.equal(parsed.ok, false, `${JSON.stringify(bad)} should fail`)
    assert.equal(typeof parsed.error.message, 'string')
    assert.equal(typeof parsed.error.position, 'number')
  }
  const expr = parseExpression('ATT.Roll (1+')
  assert.equal(expr.terms.length, 1)
  assert.equal(expr.errors.length, 1)
})

// --- functions ---------------------------------------------------------------

test('math and mavextra functions', () => {
  assert.equal(value('degrees(pi)'), 180)
  assert.ok(Math.abs(value('radians(180)') - Math.PI) < 1e-12)
  assert.equal(value('sqrt(9)+max(1,4,2)+min(3,2)'), 9)
  assert.equal(value('pow(2,10)'), 1024)
  assert.equal(value('wrap_360(-90)'), 270)
  assert.equal(value('nosuchfn(1)'), undefined)
  assert.ok(SUPPORTED_FUNCTIONS.has('lowpass'))
  assert.ok(!SUPPORTED_FUNCTIONS.has('nosuchfn'))
  const env = { message: () => undefined, param: (n) => (n === 'COMPASS_DEC' ? 0 : undefined) }
  // Level, north-pointing field -> heading 0.
  const heading = value('mag_heading(RAW_IMU,ATTITUDE)', {
    ...env,
    message: (name) => (name === 'RAW_IMU' ? { xmag: 200, ymag: 0, zmag: 400 } : { roll: 0, pitch: 0, yaw: 0 })
  })
  assert.ok(Math.abs(heading) < 1e-9)
})

test('stateful functions keep state per evaluator', () => {
  const lp = createTermEvaluator(term('lowpass(X.v,0,0.5)'))
  lp.push('X', { v: 10 }, 0)
  lp.push('X', { v: 20 }, 1)
  lp.push('X', { v: 20 }, 2)
  assert.deepEqual(lp.series().v, [10, 15, 17.5])

  const other = createTermEvaluator(term('lowpass(X.v,0,0.5)'))
  other.push('X', { v: 100 }, 0)
  assert.deepEqual(other.series().v, [100], 'a second evaluator starts fresh')

  const d = createTermEvaluator(term('diff(X.v,"k")'))
  for (const [i, v] of [3, 5, 9].entries()) d.push('X', { v }, i)
  assert.deepEqual(d.series().v, [0, 2, 4])

  const slope = createTermEvaluator(term('delta(X.v,0,X.TimeUS)'))
  slope.push('X', { v: 0, TimeUS: 0 }, 0)
  slope.push('X', { v: 5, TimeUS: 500000 }, 0.5)
  assert.deepEqual(slope.series().v, [0, 10])
})

// --- graph library ---------------------------------------------------------------

function availability(fields, instances = {}) {
  return {
    hasMessage: (m) => m in fields,
    hasField: (m, f) => (fields[m] ?? []).includes(f),
    hasInstance: (m, i) => (instances[m] ?? []).includes(i)
  }
}

test('resolveGraph picks the first expression that fits', () => {
  const graph = {
    name: 'Speed/Test',
    path: ['Speed', 'Test'],
    description: 'test',
    expressions: ['VFR_HUD.groundspeed', 'GPS[0].Spd GPS[1].Spd', 'GPS.Spd ARSP.Airspeed', 'GPS.Spd']
  }
  const single = availability({ GPS: ['Spd'] }, { GPS: [0] })
  const resolved = resolveGraph(graph, single)
  assert.equal(resolved.expression, 'GPS.Spd', 'missing GPS[1] and ARSP.Airspeed fall through')
  assert.equal(resolved.terms.length, 1)

  const dual = availability({ GPS: ['Spd'] }, { GPS: [0, 1] })
  assert.equal(resolveGraph(graph, dual).expression, 'GPS[0].Spd GPS[1].Spd')

  const unsupported = { ...graph, expressions: ['link_up(GPS,0)', 'GPS.Spd*2'] }
  assert.equal(resolveGraph(unsupported, single).expression, 'GPS.Spd*2', 'unsupported function is skipped')

  const none = resolveGraph(graph, availability({ ATT: ['Roll'] }))
  assert.ok('unavailable' in none)
  assert.match(none.unavailable, /no GPS messages/)
})

test('graphTree and searchGraphs', () => {
  const tree = graphTree(MAVGRAPHS)
  assert.equal(tree.name, '')
  const attitude = tree.children.find((c) => c.name === 'Attitude')
  assert.ok(attitude)
  assert.ok(attitude.graphs.some((g) => g.name === 'Attitude/Roll and Pitch'))
  const hits = searchGraphs(MAVGRAPHS, 'roll PITCH')
  assert.ok(hits.some((g) => g.name === 'Attitude/Roll and Pitch'))
  assert.ok(hits.every((g) => /roll/i.test(g.name + g.description) && /pitch/i.test(g.name + g.description)))
  assert.equal(searchGraphs(MAVGRAPHS, '  ').length, MAVGRAPHS.length)
})

// --- evaluator ---------------------------------------------------------------

function fmt(type, name, columns) {
  return { type, length: 0, name, format: '', columns }
}

function syntheticLog({ withFmtu }) {
  const att = []
  const baro = []
  const imu = []
  for (let i = 0; i < 5; i += 1) {
    att.push({ name: 'ATT', TimeUS: i * 100000, Roll: i, Pitch: -i })
    baro.push({ name: 'BARO', TimeUS: i * 100000 + 50000, Alt: 10 * i })
    // Two IMU instances logged back to back.
    imu.push({ name: 'IMU', TimeUS: i * 100000 + 10000, I: 0, AccX: i })
    imu.push({ name: 'IMU', TimeUS: i * 100000 + 10000, I: 1, AccX: 100 + i })
  }
  const formats = new Map([
    ['ATT', fmt(10, 'ATT', ['TimeUS', 'Roll', 'Pitch'])],
    ['BARO', fmt(11, 'BARO', ['TimeUS', 'Alt'])],
    ['IMU', fmt(12, 'IMU', ['TimeUS', 'I', 'AccX'])],
    ['FMTU', fmt(13, 'FMTU', ['TimeUS', 'FmtType', 'UnitIds', 'MultIds'])]
  ])
  const messagesByType = new Map([
    ['ATT', att],
    ['BARO', baro],
    ['IMU', imu]
  ])
  if (withFmtu) {
    messagesByType.set('FMTU', [{ name: 'FMTU', TimeUS: 0, FmtType: 12, UnitIds: 's#o', MultIds: 'F--' }])
  }
  return { messagesByType, formats, counts: new Map(), skippedBytes: 0, paddingBytes: 0 }
}

test('evaluateOnDataflash merges two message types by TimeUS', () => {
  const log = syntheticLog({ withFmtu: false })
  const [sum, alt] = evaluateOnDataflash(log, [term('ATT.Roll+BARO.Alt'), term('BARO.Alt:2')])
  // ATT at 0,0.1,..; BARO at 0.05,0.15,..: the sum starts at the first BARO,
  // then updates on every message of either type.
  assert.deepEqual(sum.t.map((t) => Math.round(t * 1000)), [50, 100, 150, 200, 250, 300, 350, 400, 450])
  assert.deepEqual(sum.v, [0, 1, 11, 12, 22, 23, 33, 34, 44])
  assert.equal(alt.axis, 2)
  assert.deepEqual(alt.v, [0, 10, 20, 30, 40])
})

for (const withFmtu of [true, false]) {
  test(`instance selection via ${withFmtu ? 'FMTU' : 'the I column fallback'}`, () => {
    const log = syntheticLog({ withFmtu })
    const [imu0, imu1, any] = evaluateOnDataflash(log, [term('IMU[0].AccX'), term('IMU[1].AccX'), term('IMU.AccX')])
    assert.deepEqual(imu0.v, [0, 1, 2, 3, 4])
    assert.deepEqual(imu1.v, [100, 101, 102, 103, 104])
    assert.equal(any.v.length, 10, 'a bare reference plots every instance, as MAVExplorer does')

    const index = dataflashFieldIndex(log)
    assert.deepEqual(index.instancesOf('IMU'), [0, 1])
    assert.ok(index.hasInstance('IMU', 1))
    assert.ok(!index.hasInstance('IMU', 2))
    assert.ok(index.hasField('ATT', 'Roll'))
    assert.ok(!index.hasField('ATT', 'Yaw'))
    assert.ok(!index.hasMessage('GPS'))
    assert.deepEqual(index.messages().map((m) => m.name), withFmtu ? ['ATT', 'BARO', 'FMTU', 'IMU'] : ['ATT', 'BARO', 'IMU'])

    assert.deepEqual(seriesFromField(log, 'IMU', 'AccX', 1).v, [100, 101, 102, 103, 104])
    assert.equal(seriesFromField(log, 'ATT', 'Pitch').label, 'ATT.Pitch')
  })
}

test('FMTU without # means the type has no instances', () => {
  const log = syntheticLog({ withFmtu: true })
  log.messagesByType.set('FMTU', [{ name: 'FMTU', TimeUS: 0, FmtType: 12, UnitIds: 's-o', MultIds: 'F--' }])
  assert.deepEqual(dataflashFieldIndex(log).instancesOf('IMU'), [])
})

test('conditions gate points', () => {
  const log = syntheticLog({ withFmtu: true })
  const [gated] = evaluateOnDataflash(log, [term('IMU.AccX{IMU.I==1}')])
  assert.deepEqual(gated.v, [100, 101, 102, 103, 104])
})

test('live evaluator: push decoded MAVLink records', () => {
  const graph = createGraphEvaluator([term('degrees(ATTITUDE.roll)'), term('VFR_HUD.groundspeed*3.6:2')])
  assert.deepEqual(graph.messageTypes().sort(), ['ATTITUDE', 'VFR_HUD'])
  graph.push('HEARTBEAT', { type: 2 }, 0)
  graph.push('ATTITUDE', { roll: Math.PI / 2, pitch: 0 }, 1)
  graph.push('VFR_HUD', { groundspeed: 10 }, 1.5)
  graph.push('ATTITUDE', { roll: Number.NaN }, 2)
  const [roll, speed] = graph.series()
  assert.deepEqual(roll.t, [1])
  assert.ok(Math.abs(roll.v[0] - 90) < 1e-9)
  assert.equal(speed.axis, 2)
  assert.deepEqual(speed.v, [36])
  // A live window drops old points but keeps the last messages: the next push still evaluates.
  graph.trimBefore(1.2)
  assert.deepEqual(graph.series()[0].t, [])
  graph.push('ATTITUDE', { roll: 0 }, 3)
  assert.deepEqual(graph.series()[0].t, [3])
  graph.reset()
  assert.equal(graph.series()[0].v.length, 0)

  const ts = createTermEvaluator(term('diff(HEARTBEAT._timestamp,"t")'))
  ts.push('HEARTBEAT', {}, 10)
  ts.push('HEARTBEAT', {}, 11.5)
  assert.deepEqual(ts.series().v, [0, 1.5])

  const unsupported = createTermEvaluator(term('link_up(GPS_RAW_INT,0)'))
  unsupported.push('GPS_RAW_INT', { fix_type: 3 }, 0)
  assert.match(unsupported.series().unsupported, /link_up/)
  assert.equal(unsupported.series().v.length, 0)
})

// --- the vendored library ----------------------------------------------------------

test('every generated MAVGRAPHS entry parses (bar known upstream typos)', () => {
  assert.ok(MAVGRAPHS.length > 200)
  const names = new Set()
  let terms = 0
  let supported = 0
  const parseErrors = []
  const unsupported = new Map()
  for (const graph of MAVGRAPHS) {
    assert.ok(!names.has(graph.name), `duplicate ${graph.name}`)
    names.add(graph.name)
    assert.deepEqual(graph.path, graph.name.split('/'))
    assert.ok(graph.expressions.length > 0, `${graph.name} has expressions`)
    let anySupported = false
    for (const expression of graph.expressions) {
      const { terms: parsed, errors } = parseExpression(expression)
      terms += parsed.length
      parseErrors.push(...errors)
      let ok = errors.length === 0
      for (const t of parsed) {
        for (const fn of termFunctions(t)) {
          if (!SUPPORTED_FUNCTIONS.has(fn)) {
            ok = false
            unsupported.set(fn, (unsupported.get(fn) ?? 0) + 1)
          }
        }
      }
      if (ok) anySupported = true
    }
    if (anySupported) supported += 1
  }
  // The only unparseable terms upstream are a misplaced paren in the
  // Aliasing graphs: `lowpass(IMU[1].AccX),1,0.9)`.
  for (const error of parseErrors) assert.match(error.text, /^lowpass\(IMU\[\d\]\.Acc[XYZ]\),\d,0\.9\)$/)
  console.log(
    `MAVGRAPHS: ${supported}/${MAVGRAPHS.length} graphs have a fully supported expression; ` +
      `${terms} terms, ${parseErrors.length} upstream parse errors; unsupported: ${[...unsupported.keys()].join(', ') || 'none'}`
  )
  assert.ok(supported >= MAVGRAPHS.length - 5)
})
