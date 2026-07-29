#!/usr/bin/env python3
"""Generate the ArduPilot parameter reference pages for the wiki.

Why this exists
---------------
ardupilot.org publishes the full parameter list as ONE page per vehicle. For
Copter 4.7 that is 5689 parameters in a single HTML document — it is genuinely
unloadable on a phone, which is the whole reason this page exists here.

So: one page per parameter GROUP (the ADSB_ / AHRS_ / ARMING_ prefix families
the upstream metadata is already keyed by), plus a search page backed by a small
prebuilt index. Every page is then a few dozen parameters at most, and finding a
parameter is a type-ahead over names rather than a browser text search across
several megabytes.

Input is a PINNED apm.pdef.json from ArduPilot/ParameterRepository, committed
alongside this script so the wiki build stays hermetic — no network, and the
docs cannot silently change under a release.

Regenerating for a new firmware release:

    curl -o wiki/data/apm.pdef.Copter-4.7.json \\
      https://raw.githubusercontent.com/ArduPilot/ParameterRepository/master/Copter-4.7/apm.pdef.json
    python3 wiki/tools/generate_parameter_reference.py
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
WIKI = HERE.parent
DATA = WIKI / "data"
OUT = WIKI / "parameters"

# (source file, vehicle label, firmware label) — add a row to publish another
# vehicle's reference.
SOURCES = [
    ("apm.pdef.Copter-4.7.json", "ArduCopter", "4.7"),
]


def rst_escape(text: str) -> str:
    """Neutralise the inline markup characters that appear in upstream prose.

    Underscores matter most: upstream descriptions are full of parameter names
    like ``SERIALn_`` and ``EK3_SRCx_VEL``, and a trailing underscore is RST's
    hyperlink-reference syntax — each one became an "Unknown target name" build
    error. A backslash-escaped underscore renders identically, so escaping every
    one is both safe and visually invisible.
    """
    return (
        text.replace("\\", "\\\\")
        .replace("*", "\\*")
        .replace("|", "\\|")
        .replace("_", "\\_")
        .replace("`", "\\`")
    )


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def slug(group: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", group).strip("-").lower() or "misc"


def unique_slugs(groups: list[str]) -> dict[str, str]:
    """Map each group to a distinct page slug.

    Upstream ships families that differ ONLY by a trailing underscore (ARSPD vs
    ARSPD_, PRX1 vs PRX1_, ...). Slugging strips the underscore, so those pairs
    collided and the second family silently overwrote the first — 77 parameters
    vanished from the reference without any error. Disambiguate with a numeric
    suffix, deterministically ordered so the same input always yields the same
    filenames.
    """
    assigned: dict[str, str] = {}
    used: dict[str, int] = {}
    for group in sorted(groups):
        base = slug(group)
        if base not in used:
            used[base] = 1
            assigned[group] = base
        else:
            used[base] += 1
            assigned[group] = f"{base}-{used[base]}"
    return assigned


def render_values(values) -> list[str]:
    """Upstream ships Values as either a dict or a list of single-key dicts."""
    pairs: list[tuple[str, str]] = []
    if isinstance(values, dict):
        pairs = [(str(k), str(v)) for k, v in values.items()]
    elif isinstance(values, list):
        for entry in values:
            if isinstance(entry, dict):
                pairs.extend((str(k), str(v)) for k, v in entry.items())
    if not pairs:
        return []

    def sort_key(pair: tuple[str, str]):
        try:
            return (0, float(pair[0]))
        except ValueError:
            return (1, 0.0)

    lines = ["   .. list-table::", "      :header-rows: 1", "      :widths: 20 80", "",
             "      * - Value", "        - Meaning"]
    for key, label in sorted(pairs, key=sort_key):
        lines.append(f"      * - ``{rst_escape(clean(key))}``")
        lines.append(f"        - {rst_escape(clean(label))}")
    lines.append("")
    return lines


def render_parameter(name: str, meta: dict) -> tuple[list[str], dict]:
    lines: list[str] = []
    display = clean(meta.get("DisplayName", name))
    lines.append(f".. _param-{name.lower()}:")
    lines.append("")
    lines.append(name)
    lines.append("~" * len(name))
    lines.append("")
    lines.append(f"**{rst_escape(display)}**")
    lines.append("")

    description = clean(meta.get("Description", ""))
    if description:
        lines.append(rst_escape(description))
        lines.append("")

    # Compact field table — only the fields this parameter actually carries, so
    # a simple parameter stays visually simple.
    facts: list[tuple[str, str]] = []
    units = meta.get("Units")
    if units:
        facts.append(("Units", f"``{clean(units)}``"))
    rng = meta.get("Range")
    if isinstance(rng, dict) and ("low" in rng or "high" in rng):
        facts.append(("Range", f"``{clean(rng.get('low', '?'))}`` to ``{clean(rng.get('high', '?'))}``"))
    increment = meta.get("Increment")
    if increment:
        facts.append(("Increment", f"``{clean(increment)}``"))
    if meta.get("RebootRequired"):
        facts.append(("Reboot required", "Yes — the change takes effect after a reboot."))
    if meta.get("ReadOnly"):
        facts.append(("Read only", "Yes"))
    if meta.get("Calibration"):
        facts.append(("Calibration", "Written by a calibration routine — do not hand-edit."))
    user = meta.get("User")
    if user:
        facts.append(("User level", clean(user)))

    if facts:
        lines.append(".. list-table::")
        lines.append("   :widths: 25 75")
        lines.append("")
        for label, value in facts:
            lines.append(f"   * - {label}")
            lines.append(f"     - {value}")
        lines.append("")

    bitmask = meta.get("Bitmask")
    if bitmask:
        lines.append("Bitmask")
        lines.append("^^^^^^^")
        lines.append("")
        lines.extend(render_values(bitmask))

    values = meta.get("Values")
    if values:
        lines.append("Values")
        lines.append("^^^^^^")
        lines.append("")
        lines.extend(render_values(values))

    index_entry = {
        "n": name,
        "d": display,
        "u": clean(units) if units else "",
        "r": bool(meta.get("RebootRequired")),
    }
    return lines, index_entry


def generate(source: str, vehicle: str, firmware: str) -> None:
    payload = json.loads((DATA / source).read_text())
    groups = {
        group: params
        for group, params in payload.items()
        if isinstance(params, dict) and params
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("group-*.rst"):
        stale.unlink()

    search_index: list[dict] = []
    group_rows: list[tuple[str, str, int]] = []
    slugs = unique_slugs(list(groups))

    for group in sorted(groups):
        params = groups[group]
        page_slug = slugs[group]
        # A trailing underscore is RST's hyperlink-reference syntax, and every
        # ArduPilot family name ends in one (ADSB_, AHRS_, ...). Unescaped, each
        # page title parsed as a reference to a target that does not exist —
        # 288 build errors and a mangled heading. Escape it.
        title = f"{group.replace('_', chr(92) + '_')} parameters"
        lines = [
            f".. _params-{page_slug}:",
            "",
            title,
            "=" * len(title),
            "",
            f"{len(params)} parameters in the ``{group}`` family "
            f"({vehicle} {firmware}).",
            "",
        ]
        # NO ".. contents::" here. Furo builds its own "On this page" sidebar
        # from the headings and rejects the directive by rendering a red ERROR
        # block INTO the page — which sphinx-build reports as neither an error
        # nor a warning, so a clean build log said nothing while all 387 pages
        # carried the banner.
        for name in sorted(params):
            meta = params[name]
            if not isinstance(meta, dict):
                continue
            body, entry = render_parameter(name, meta)
            lines.extend(body)
            entry["g"] = page_slug
            search_index.append(entry)
        (OUT / f"group-{page_slug}.rst").write_text("\n".join(lines) + "\n")
        group_rows.append((group, page_slug, len(params)))

    # Search payload: names + display names only. Deliberately NOT the
    # descriptions — this is a "find the parameter" index, and keeping it small
    # is what makes it instant on a phone.
    (WIKI / "_static" / "parameter-index.json").write_text(
        json.dumps({"vehicle": vehicle, "firmware": firmware, "params": search_index},
                   separators=(",", ":"))
    )

    assert len({page_slug for _, page_slug, _ in group_rows}) == len(group_rows), (
        "page slugs collided — parameters would be silently dropped"
    )
    total = sum(count for _, _, count in group_rows)
    index_lines = [
        ".. _parameter-reference:",
        "",
        "Parameter Reference",
        "===================",
        "",
        f"Every {vehicle} {firmware} parameter — **{total}** of them, across "
        f"{len(group_rows)} families.",
        "",
        "Upstream publishes this as a single page per vehicle, which is too large to",
        "open comfortably on a phone. Here each family is its own small page, and",
        ":doc:`search` filters the whole set as you type.",
        "",
        ".. note::",
        "",
        "   Generated from ArduPilot's own parameter metadata",
        f"   (``ParameterRepository``, {vehicle}-{firmware}). A parameter only exists on",
        "   your aircraft if the firmware build includes that subsystem — the",
        "   Parameters tab in ArduConfigurator shows what your controller actually",
        "   reports.",
        "",
        ".. toctree::",
        "   :hidden:",
        "",
        "   search",
    ]
    for _, page_slug, _ in group_rows:
        index_lines.append(f"   group-{page_slug}")
    index_lines += [
        "",
        ".. list-table::",
        "   :header-rows: 1",
        "   :widths: 30 15 55",
        "",
        "   * - Family",
        "     - Count",
        "     - ",
    ]
    for group, page_slug, count in group_rows:
        index_lines.append(f"   * - :doc:`{group} <group-{page_slug}>`")
        index_lines.append(f"     - {count}")
        index_lines.append("     - ")
    index_lines.append("")
    (OUT / "index.rst").write_text("\n".join(index_lines) + "\n")

    print(f"{vehicle} {firmware}: {total} parameters across {len(group_rows)} pages")


def main() -> int:
    if not DATA.exists():
        print(f"missing data directory: {DATA}", file=sys.stderr)
        return 1
    for source, vehicle, firmware in SOURCES:
        if not (DATA / source).exists():
            print(f"missing pinned metadata: {DATA / source}", file=sys.stderr)
            return 1
        generate(source, vehicle, firmware)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
