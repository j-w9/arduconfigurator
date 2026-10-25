#!/usr/bin/env python3
"""
Generate the DroneCAN type catalogue (and codec test vectors) from DSDL.

The catalogue is what packages/dronecan-dsdl decodes and encodes against:
every type's fields, array modes, unions, constants, default data type id and
data type signature. It is produced by pydronecan's own DSDL parser -- the
reference implementation -- so the signatures and layouts are the reference
ones, not a re-derivation. The output is committed; the app's build needs
no Python.

The test vectors are values packed by pydronecan itself (seeded, so the file
is reproducible): the TypeScript codec must decode each to the same value
and encode the value back to the same bytes.

Usage (from the repo root, with an ArduPilot checkout):
  python3 packages/dronecan-dsdl/tools/generate.py ~/development/ardupilot/modules/DroneCAN

DSDL and pydronecan are MIT-licensed (c) 2014-2015 Pavel Kirienko and the
DroneCAN contributors; see packages/dronecan-dsdl/NOTICE.
"""

import json
import os
import random
import subprocess
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/development/ardupilot/modules/DroneCAN'))
sys.path.insert(0, os.path.join(ROOT, 'pydronecan'))

import dronecan  # noqa: E402
from dronecan import transport  # noqa: E402
from dronecan.dsdl import parse_namespaces  # noqa: E402
from dronecan.dsdl.parser import ArrayType, CompoundType, PrimitiveType, VoidType  # noqa: E402

DSDL = os.path.join(ROOT, 'DSDL')
NAMESPACES = sorted(
    os.path.join(DSDL, name)
    for name in os.listdir(DSDL)
    if os.path.isdir(os.path.join(DSDL, name)) and not name.startswith('.') and name != 'tests'
)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_CATALOGUE = os.path.join(HERE, '..', 'src', 'generated', 'catalogue.ts')
OUT_VECTORS = os.path.join(HERE, '..', '..', '..', 'tests', 'fixtures', 'dronecan-dsdl-vectors.json')

KIND = {PrimitiveType.KIND_BOOLEAN: 'b', PrimitiveType.KIND_UNSIGNED_INT: 'u', PrimitiveType.KIND_SIGNED_INT: 'i', PrimitiveType.KIND_FLOAT: 'f'}
CAST = {PrimitiveType.CAST_MODE_SATURATED: 's', PrimitiveType.CAST_MODE_TRUNCATED: 't'}


def describe(t):
    if isinstance(t, PrimitiveType):
        out = {'p': KIND[t.kind], 'bits': t.bitlen}
        if t.kind != PrimitiveType.KIND_BOOLEAN:
            out['c'] = CAST[t.cast_mode]
        return out
    if isinstance(t, VoidType):
        return {'v': t.bitlen}
    if isinstance(t, ArrayType):
        return {
            'a': describe(t.value_type),
            'm': 's' if t.mode == ArrayType.MODE_STATIC else 'd',
            'max': t.max_size,
            # TAO applies to a trailing dynamic array only when an element is
            # at least 8 bits (pydronecan ArrayValue._pack / _unpack).
            'eMin': t.value_type.get_min_bitlen(),
        }
    if isinstance(t, CompoundType):
        return {'r': t.full_name}
    raise ValueError('unknown type %r' % t)


def section(fields, constants, union):
    return {
        'union': bool(union),
        'fields': [{'n': None if isinstance(f.type, VoidType) else f.name, 't': describe(f.type)} for f in fields],
        'consts': [{'n': c.name, 't': describe(c.type), 'v': c.value} for c in constants],
    }


def catalogue(types):
    out = {}
    for t in types:
        entry = {
            'k': 'm' if t.kind == CompoundType.KIND_MESSAGE else 's',
            'id': t.default_dtid,
            'sig': format(t.get_data_type_signature(), '016x'),
        }
        if t.kind == CompoundType.KIND_MESSAGE:
            entry['msg'] = section(t.fields, t.constants, t.union)
        else:
            entry['req'] = section(t.request_fields, t.request_constants, t.request_union)
            entry['res'] = section(t.response_fields, t.response_constants, t.response_union)
        out[t.full_name] = entry
    return out


rng = random.Random(20261009)


def random_primitive(t):
    if t.kind == PrimitiveType.KIND_BOOLEAN:
        return rng.random() < 0.5
    if t.kind == PrimitiveType.KIND_UNSIGNED_INT:
        return rng.randint(0, (1 << t.bitlen) - 1)
    if t.kind == PrimitiveType.KIND_SIGNED_INT:
        return rng.randint(-(1 << (t.bitlen - 1)), (1 << (t.bitlen - 1)) - 1)
    # Finite floats in a range float16 can hold, so every width round-trips.
    return rng.uniform(-1000.0, 1000.0)


def fill(value, t):
    """Fill a pydronecan CompoundValue `value` (of compound type t's section) at random."""
    fields = [name for name in value._fields.keys() if not name.startswith('_void_')]
    if transport.is_union(value):
        chosen = rng.choice(list(value._fields.keys()))
        transport.switch_union_field(value, None)
        value._union_field = chosen
        fields = [chosen]
    for name in fields:
        field = value._fields[name]
        fill_field(value, name, field)


def fill_field(owner, name, field):
    if isinstance(field, transport.PrimitiveValue):
        field.value = random_primitive(field._type)
    elif isinstance(field, transport.ArrayValue):
        at = field._type
        count = at.max_size if at.mode == ArrayType.MODE_STATIC else rng.randint(0, min(at.max_size, 6))
        del field[:]
        for _ in range(count):
            if isinstance(at.value_type, PrimitiveType):
                field.append(random_primitive(at.value_type))
            else:
                item = field.new_item()
                fill(item, at.value_type)
                field.append(item)
    elif isinstance(field, transport.CompoundValue):
        fill(field, field._type)


def plain(v):
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > (1 << 53):
        return {'$bigint': str(v)}
    return v


def to_json(value):
    if isinstance(value, transport.PrimitiveValue):
        return plain(value.value)
    if isinstance(value, (bool, int, float)):
        # Iterating a primitive array yields plain Python values.
        return plain(value)
    if isinstance(value, transport.ArrayValue):
        return [to_json(item) for item in value]
    if isinstance(value, transport.CompoundValue):
        if transport.is_union(value):
            name = value._union_field or list(value._fields.keys())[0]
            return {name: to_json(value._fields[name])}
        return {name: to_json(field) for name, field in value._fields.items() if not name.startswith('_void_')}
    raise ValueError('cannot serialise %r' % value)


def vectors(types):
    out = []
    for t in types:
        modes = [None] if t.kind == CompoundType.KIND_MESSAGE else ['request', 'response']
        for mode in modes:
            for sample in range(3):
                for tao in (True, False):
                    if not tao and sample > 0:
                        continue
                    value = transport.CompoundValue(t, _mode=mode)
                    fill(value, t)
                    bits = value._pack(tao=tao)
                    payload = transport.bytes_from_bits(bits)
                    # The canonical value is what the reference decoder reads back.
                    decoded = transport.CompoundValue(t, _mode=mode)
                    decoded._unpack(transport.bits_from_bytes(payload), tao=tao)
                    out.append({
                        'type': t.full_name,
                        'section': {None: 'msg', 'request': 'req', 'response': 'res'}[mode],
                        'tao': tao,
                        'hex': payload.hex(),
                        'value': to_json(decoded),
                    })
    return out


def main():
    types = sorted(parse_namespaces(NAMESPACES), key=lambda t: t.full_name)
    try:
        commit = subprocess.check_output(['git', '-C', DSDL, 'rev-parse', 'HEAD'], text=True).strip()
    except Exception:
        commit = 'unknown'
    data = json.dumps({'dsdlCommit': commit, 'types': catalogue(types)}, separators=(',', ':'), sort_keys=True)
    with open(OUT_CATALOGUE, 'w') as handle:
        handle.write('// GENERATED by packages/dronecan-dsdl/tools/generate.py from the DroneCAN DSDL\n')
        handle.write('// (MIT, see ../../NOTICE). Do not edit; regenerate.\n')
        handle.write("import type { DronecanCatalogueData } from '../types.js'\n\n")
        handle.write('export const DRONECAN_CATALOGUE_DATA: DronecanCatalogueData = JSON.parse(%s)\n' % json.dumps(data))
    with open(OUT_VECTORS, 'w') as handle:
        json.dump({'dsdlCommit': commit, 'vectors': vectors(types)}, handle, separators=(',', ':'))
        handle.write('\n')
    print('%d types -> %s' % (len(types), os.path.relpath(OUT_CATALOGUE)))


if __name__ == '__main__':
    main()
