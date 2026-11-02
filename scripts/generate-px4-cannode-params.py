#!/usr/bin/env python3
"""Generate apps/web/src/view-models/generated/px4-cannode-params.ts from PX4's published metadata.

PX4 "cannode" boards (CONFIG_DRIVERS_UAVCANNODE -- ARK CAN RTK GPS, Holybro
CAN GPS, CUAV CAN GPS, ...) are DroneCAN peripherals whose parameters are PX4
parameters (CANNODE_NODE_ID, GPS_UBX_DYNMODEL, SENS_BOARD_ROT, ...). Like
AP_Periph, the node reports values but no label/range/enum, so the CAN tab
needs a catalog. PX4's CI publishes per-board parameter metadata at

  https://px4-travis.s3.amazonaws.com/Firmware/master/<vendor>_<board>_default/parameters.json.xz

and each board's DroneCAN node name (HW_UAVCAN_NAME, e.g. "org.ark.can-rtk-gps")
lives in boards/<vendor>/<board>/uavcan_board_identity (a CMake fragment;
board_config.h is checked too, for a literal `#define HW_UAVCAN_NAME "..."`).

This script downloads both for every board in CANNODE_BOARDS (a board whose
metadata is not published is logged and skipped), unions the parameters by
name (first board wins; a differing definition on a later board is reported),
maps each one to the CAN tab's DronecanParamCatalogDef, de-duplicates
identical definitions (BAT1_..BAT3_, CAL_ACC0_..CAL_ACC3_ share one def each)
and writes a compact TS module that JSON.parses an embedded string -- the
same shape and decoder as ap-periph-params.ts.

Mapping (PX4 field -> catalog field):
  shortDesc -> label; longDesc (whitespace-collapsed) else shortDesc -> description;
  min/max -> minimum/maximum; units -> unit; increment -> step;
  values -> options (sorted by value, only when there is no bitmask);
  bitmask -> bits [{bit: index, label: description}]; rebootRequired -> rebootRequired.
  Dropped: default, type, volatile, decimalPlaces, group, category.

Usage:
  python3 scripts/generate-px4-cannode-params.py [--out PATH]

Licensing: PX4 parameter documentation is BSD-3-Clause (PX4-Autopilot). This
repository is GPL-3.0-only; the generated module carries the provenance.
"""

import argparse
import datetime
import json
import lzma
import os
import re
import sys
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, 'apps', 'web', 'src', 'view-models', 'generated', 'px4-cannode-params.ts')

METADATA_URL = 'https://px4-travis.s3.amazonaws.com/Firmware/master/{vendor}_{board}_default/parameters.json.xz'
BOARD_FILE_URL = 'https://raw.githubusercontent.com/PX4/PX4-Autopilot/main/boards/{vendor}/{board}/{path}'

# PX4 boards built with CONFIG_DRIVERS_UAVCANNODE (boards/<vendor>/<board>/default.px4board).
# Order matters: the first board that defines a parameter wins.
CANNODE_BOARDS = (
    'ark/can-flow-lr',
    'ark/can-flow-mr',
    'ark/can-flow',
    'ark/can-gps',
    'ark/can-rtk-gps',
    'ark/cannode',
    'cuav/can-gps-v1',
    'freefly/can-rtk-gps',
    'holybro/can-gps-v1',
    'nxp/ucans32k146',
)

# uavcan_board_identity:  set(uavcanblid_name "\"org.ark.can-rtk-gps\"")
IDENTITY_NAME_RE = re.compile(r'set\s*\(\s*uavcanblid_name\s+"\\?"([^"\\]+)\\?""\s*\)')
# board_config.h:         #define HW_UAVCAN_NAME "org.ark.can-rtk-gps"
DEFINE_NAME_RE = re.compile(r'#\s*define\s+HW_UAVCAN_NAME\s+"([^"]+)"')


def fetch(url, timeout=60):
    """Return the body bytes, or None on HTTP 404 (anything else raises)."""
    request = urllib.request.Request(url, headers={'User-Agent': 'ArduConfigurator generate-px4-cannode-params'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def fetch_node_name(vendor, board):
    identity = fetch(BOARD_FILE_URL.format(vendor=vendor, board=board, path='uavcan_board_identity'))
    if identity is not None:
        match = IDENTITY_NAME_RE.search(identity.decode('utf-8', 'replace'))
        if match:
            return match.group(1)
    header = fetch(BOARD_FILE_URL.format(vendor=vendor, board=board, path='src/board_config.h'))
    if header is not None:
        match = DEFINE_NAME_RE.search(header.decode('utf-8', 'replace'))
        if match:
            return match.group(1)
    return None


def to_number(value):
    number = float(value)
    return int(number) if number.is_integer() else number


def collapse_whitespace(text):
    return ' '.join(str(text).split())


def compact_def(param):
    """Map one PX4 parameters.json entry to the compact def (short keys)."""
    out = {}
    short = collapse_whitespace(param.get('shortDesc', ''))
    long_ = collapse_whitespace(param.get('longDesc', ''))
    if short:
        out['l'] = short
    if long_ or short:
        out['d'] = long_ or short
    if param.get('units'):
        out['u'] = str(param['units'])
    for src, dst in (('min', 'mn'), ('max', 'mx'), ('increment', 'i')):
        if param.get(src) is not None:
            try:
                out[dst] = to_number(param[src])
            except (TypeError, ValueError):
                pass
    bitmask = param.get('bitmask')
    if isinstance(bitmask, list) and bitmask:
        pairs = sorted(([to_number(b['index']), collapse_whitespace(b['description'])] for b in bitmask),
                       key=lambda pair: pair[0])
        out['b'] = pairs
    else:
        values = param.get('values')
        if isinstance(values, list) and values:
            pairs = sorted(([to_number(v['value']), collapse_whitespace(v['description'])] for v in values),
                           key=lambda pair: pair[0])
            out['o'] = pairs
    if param.get('rebootRequired') is True:
        out['r'] = 1
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', default=OUT_PATH)
    args = parser.parse_args()

    params = {}        # name -> compact def (first board wins)
    owner = {}         # name -> board that defined it
    included = []      # boards whose metadata was used
    node_names = []    # distinct HW_UAVCAN_NAME values, in board order
    skipped = []       # (board, reason)
    disagreements = 0

    for board_path in CANNODE_BOARDS:
        vendor, board = board_path.split('/', 1)
        node_name = fetch_node_name(vendor, board)
        if node_name is None:
            skipped.append((board_path, 'no HW_UAVCAN_NAME'))
            print(f'skip {board_path}: no HW_UAVCAN_NAME in uavcan_board_identity or board_config.h', file=sys.stderr)
            continue
        url = METADATA_URL.format(vendor=vendor, board=board)
        body = fetch(url)
        if body is None:
            skipped.append((board_path, '404 ' + url))
            print(f'skip {board_path}: 404 {url}', file=sys.stderr)
            continue
        metadata = json.loads(lzma.decompress(body).decode('utf-8'))
        if metadata.get('version') != 1:
            print(f'note {board_path}: parameters.json version {metadata.get("version")!r} (expected 1)', file=sys.stderr)
        count = 0
        for param in metadata.get('parameters', []):
            name = param.get('name')
            if not name:
                continue
            compact = compact_def(param)
            if name in params:
                if params[name] != compact:
                    disagreements += 1
                    print(f'note {name}: {board_path} differs from {owner[name]} (keeping {owner[name]})', file=sys.stderr)
                continue
            params[name] = compact
            owner[name] = board_path
            count += 1
        included.append(board_path)
        if node_name not in node_names:
            node_names.append(node_name)
        print(f'{board_path} ({node_name}): {len(metadata.get("parameters", []))} params, {count} new')

    if not included:
        sys.exit('no board metadata could be fetched')

    # Compact encoding (the module ships in the web bundle), same as ap-periph-params.ts:
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

    fetched = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    source = (f'PX4-Autopilot master parameters.json.xz (px4-travis.s3.amazonaws.com), fetched {fetched} UTC; '
              f'boards: {", ".join(included)}')
    payload = {'src': source, 'n': node_names, 's': table(strings), 'L': table(lists), 'D': table(defs), 'p': grouped}
    blob = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)

    header = (
        '// GENERATED by scripts/generate-px4-cannode-params.py from PX4-Autopilot\'s published\n'
        '// parameter metadata. PX4 parameter documentation is BSD-3-Clause (PX4-Autopilot,\n'
        '// https://github.com/PX4/PX4-Autopilot); this repository is GPL-3.0-only.\n'
        '// Sources:\n'
        '//   https://px4-travis.s3.amazonaws.com/Firmware/master/<vendor>_<board>_default/parameters.json.xz\n'
        '//   https://raw.githubusercontent.com/PX4/PX4-Autopilot/main/boards/<vendor>/<board>/uavcan_board_identity\n'
        f'// Boards ({len(included)}): {", ".join(included)}\n'
        + ''.join(f'// Skipped: {board} ({reason})\n' for board, reason in skipped)
        + f'// Fetched {fetched} UTC. {len(params)} params, {len(defs)} distinct definitions. Do not edit; regenerate.\n'
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
  src: string
  n: string[]
  s: string[]
  L: Array<Array<[number, string]>>
  D: CompactDef[]
  p: Record<string, Record<string, number>>
}

const DATA: Payload = JSON.parse(%s)

/** One-line provenance: where and when the metadata was fetched, and which boards went in. */
export const PX4_CANNODE_METADATA_SOURCE: string = DATA.src

/** DroneCAN node names (HW_UAVCAN_NAME) of the PX4 cannode boards this catalog covers. */
export const PX4_CANNODE_NODE_NAMES: readonly string[] = Object.freeze(DATA.n)

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

/** Every parameter the PX4 cannode boards publish, keyed by on-node name.
 *  Instances of a family (BAT1_.., CAL_ACC0_..) share one frozen def object. */
export const PX4_CANNODE_GENERATED_PARAMS: Readonly<Record<string, DronecanParamCatalogDef>> = Object.fromEntries(
  Object.entries(DATA.p).flatMap(([prefix, members]) =>
    Object.entries(members).map(([suffix, index]) => [prefix + suffix, Object.freeze(EXPANDED[index]!)])
  )
)
''' % json.dumps(blob, ensure_ascii=False)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as f:
        f.write(header + body)
    print(f'wrote {args.out}: {len(params)} params, {len(defs)} defs, {os.path.getsize(args.out)} bytes')
    print(f'boards: {", ".join(included)}')
    print(f'node names: {", ".join(node_names)}')
    if skipped:
        print('skipped: ' + '; '.join(f'{board} ({reason})' for board, reason in skipped))
    if disagreements:
        print(f'{disagreements} definition(s) differed between boards (first board kept)')


if __name__ == '__main__':
    main()
