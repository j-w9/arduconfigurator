#!/usr/bin/env python3
"""Generate apps/web/src/view-models/generated/ap-periph-params.ts from ArduPilot source.

AP_Periph (DroneCAN peripheral firmware) usually strips parameter metadata, so
a node reports a value but no label/range/enum. ArduPilot's own
Tools/autotest/param_metadata/param_parse.py supports `--vehicle AP_Periph`
(it walks Tools/AP_Periph/Parameters.cpp and every library @Group it pulls in),
which is exactly how ArduPilot builds the AP_Periph metadata for its GCSs. This
script runs it against a PINNED ArduPilot commit (exported with `git archive`,
so local edits in the checkout never leak in), trims the result to the fields
the CAN tab uses, de-duplicates identical definitions (BATT2_..BATTG_, OUTn_,
MAVn_, RNGFNDn_ ... share one def each) and writes a compact TS module that
JSON.parses an embedded string.

Dropped groups:
  * ''     -- Lua applet params (AEROM_, QUIK_, ...): scripts, not AP_Periph.
  * SIM_*  -- SITL-only simulation params.
Renamed:
  * Node_* -> STAT_*: Parameters.cpp documents the AP_Stats group as
    "@Group: Node" but registers it as GOBJECT(node_stats, "STAT", AP_Stats),
    so the on-node names are STAT_BOOTCNT etc.

Usage:
  python3 scripts/generate-ap-periph-params.py [--ardupilot ~/development/ardupilot] [--commit SHA]

GPL-3.0-only (ArduPilot parameter documentation is GPL-3.0).
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, 'apps', 'web', 'src', 'view-models', 'generated', 'ap-periph-params.ts')

# The ArduPilot commit the checked-in module was generated from. Bump
# deliberately (and regenerate) -- the header records whatever was used.
DEFAULT_COMMIT = 'aa8e936baf7ab18ddb895b7ddb2751a7ba31a790'

DROP_GROUPS = {''}
DROP_PREFIXES = ('SIM_',)
RENAME_PREFIXES = {'Node_': 'STAT_'}


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def export_tree(ardupilot, commit, dest):
    """Export Tools/ and libraries/ of `commit` into dest (no working-tree edits)."""
    archive = subprocess.Popen(['git', '-C', ardupilot, 'archive', '--format=tar', commit, 'Tools', 'libraries'],
                               stdout=subprocess.PIPE)
    run(['tar', '-x', '-C', dest], stdin=archive.stdout)
    archive.stdout.close()
    if archive.wait() != 0:
        sys.exit('git archive failed')


def to_number(text):
    value = float(text)
    return int(value) if value.is_integer() else value


def numeric_pairs(mapping):
    pairs = []
    for key, label in mapping.items():
        try:
            pairs.append([to_number(key), label])
        except ValueError:
            continue
    pairs.sort(key=lambda pair: pair[0])
    return pairs


def compact_def(param):
    """Map one apm.pdef.json entry to the compact def (short keys)."""
    out = {}
    if param.get('DisplayName'):
        out['l'] = param['DisplayName']
    if param.get('Description'):
        out['d'] = param['Description']
    if param.get('Units'):
        out['u'] = param['Units']
    rng = param.get('Range')
    if isinstance(rng, dict):
        try:
            out['mn'] = to_number(rng['low'])
            out['mx'] = to_number(rng['high'])
        except (KeyError, ValueError):
            pass
    if param.get('Increment'):
        try:
            out['i'] = to_number(param['Increment'])
        except ValueError:
            pass
    if isinstance(param.get('Values'), dict):
        pairs = numeric_pairs(param['Values'])
        if pairs:
            out['o'] = pairs
    if isinstance(param.get('Bitmask'), dict):
        pairs = numeric_pairs(param['Bitmask'])
        if pairs:
            out['b'] = pairs
    if str(param.get('RebootRequired', '')).lower() == 'true':
        out['r'] = 1
    if str(param.get('ReadOnly', '')).lower() == 'true':
        out['ro'] = 1
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--ardupilot', default=os.path.expanduser('~/development/ardupilot'))
    parser.add_argument('--commit', default=DEFAULT_COMMIT)
    parser.add_argument('--out', default=OUT_PATH)
    args = parser.parse_args()

    commit = subprocess.check_output(['git', '-C', args.ardupilot, 'rev-parse', args.commit + '^{commit}'],
                                     text=True).strip()

    with tempfile.TemporaryDirectory() as tmp:
        tree = os.path.join(tmp, 'ardupilot')
        os.makedirs(tree)
        export_tree(args.ardupilot, commit, tree)
        workdir = os.path.join(tmp, 'out')
        os.makedirs(workdir)
        script = os.path.join(tree, 'Tools', 'autotest', 'param_metadata', 'param_parse.py')
        # param_parse reports doc lint (duplicate fields etc.) on stdout and may
        # exit non-zero for it; the JSON is still emitted.
        subprocess.run([sys.executable, script, '--vehicle', 'AP_Periph', '--format', 'json'],
                       cwd=workdir, stdout=subprocess.DEVNULL)
        pdef_path = os.path.join(workdir, 'apm.pdef.json')
        if not os.path.exists(pdef_path):
            sys.exit('param_parse.py did not emit apm.pdef.json')
        with open(pdef_path) as f:
            pdef = json.load(f)

    params = {}
    for group, members in pdef.items():
        if group == 'json' or group in DROP_GROUPS or not isinstance(members, dict):
            continue
        for name, param in members.items():
            if not isinstance(param, dict) or name.startswith(DROP_PREFIXES):
                continue
            for old, new in RENAME_PREFIXES.items():
                if name.startswith(old):
                    name = new + name[len(old):]
            params[name] = compact_def(param)

    # Compact encoding (the module ships in the web bundle):
    #   s: string table (labels + descriptions, deduped)
    #   L: option/bitmask lists, deduped ([[value, label], ...])
    #   D: distinct defs, referencing s/L by index
    #   p: {prefix: {suffix: defIndex}} -- names grouped on their first '_'
    strings, lists, defs = {}, {}, {}

    def intern(table, value):
        key = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        if key not in table:
            table[key] = (len(table), value)
        return table[key][0]

    grouped = {}
    for name in sorted(params):
        d = dict(params[name])
        for field in ('l', 'd'):
            if field in d:
                d[field] = intern(strings, d[field])
        for field in ('o', 'b'):
            if field in d:
                d[field] = intern(lists, d[field])
        cut = name.find('_') + 1
        grouped.setdefault(name[:cut], {})[name[cut:]] = intern(defs, d)

    def table(t):
        return [value for _, value in sorted(t.values(), key=lambda item: item[0])]

    payload = {'c': commit, 's': table(strings), 'L': table(lists), 'D': table(defs), 'p': grouped}
    blob = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
    names = params

    header = (
        '// GENERATED by scripts/generate-ap-periph-params.py from ArduPilot\n'
        f'// (GPL-3.0) commit {commit} via\n'
        '// `Tools/autotest/param_metadata/param_parse.py --vehicle AP_Periph --format json`.\n'
        f'// {len(names)} params, {len(defs)} distinct definitions. Do not edit; regenerate.\n'
    )
    body = '''import type { DronecanParamCatalogDef } from '../dronecan-param-display'

/** Compact def: l/d index `s`, o/b index `L`. */
interface CompactDef {
  l?: number
  d?: number
  u?: string
  mn?: number
  mx?: number
  i?: number
  o?: number
  b?: number
  r?: 1
  ro?: 1
}
interface Payload {
  c: string
  s: string[]
  L: Array<Array<[number, string]>>
  D: CompactDef[]
  p: Record<string, Record<string, number>>
}

const DATA: Payload = JSON.parse(%s)

/** The ArduPilot commit this metadata was generated from. */
export const AP_PERIPH_PARAMS_ARDUPILOT_COMMIT: string = DATA.c

function expand(def: CompactDef): DronecanParamCatalogDef {
  const out: DronecanParamCatalogDef = {}
  if (def.l !== undefined) out.label = DATA.s[def.l]
  if (def.d !== undefined) out.description = DATA.s[def.d]
  if (def.u !== undefined) out.unit = def.u
  if (def.mn !== undefined) out.minimum = def.mn
  if (def.mx !== undefined) out.maximum = def.mx
  if (def.i !== undefined) out.step = def.i
  if (def.o !== undefined) out.options = DATA.L[def.o]!.map(([value, label]) => ({ value, label }))
  if (def.b !== undefined) out.bits = DATA.L[def.b]!.map(([bit, label]) => ({ bit, label }))
  if (def.r) out.rebootRequired = true
  if (def.ro) out.readOnly = true
  return out
}

const EXPANDED: DronecanParamCatalogDef[] = DATA.D.map(expand)

/** Every AP_Periph parameter ArduPilot documents, keyed by on-node name.
 *  Instances of a family (BATT2_.., OUTn_..) share one frozen def object. */
export const AP_PERIPH_GENERATED_PARAMS: Readonly<Record<string, DronecanParamCatalogDef>> = Object.fromEntries(
  Object.entries(DATA.p).flatMap(([prefix, members]) =>
    Object.entries(members).map(([suffix, index]) => [prefix + suffix, Object.freeze(EXPANDED[index]!)])
  )
)
''' % json.dumps(blob, ensure_ascii=False)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as f:
        f.write(header + body)
    print(f'wrote {args.out}: {len(names)} params, {len(defs)} defs, {os.path.getsize(args.out)} bytes (commit {commit})')


if __name__ == '__main__':
    main()
