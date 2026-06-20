# Generates a TS lookup of ArduPilot bootloader board ids → friendly names.
# Source: https://github.com/ArduPilot/ardupilot/blob/master/Tools/AP_Bootloader/board_types.txt
# On id collision (e.g. FMU_V2/V3/CUBE_F4 all = 9) the FIRST seen wins —
# this matches the order in the source file and keeps the canonical name.
# Run via:
#   gh api repos/ArduPilot/ardupilot/contents/Tools/AP_Bootloader/board_types.txt --jq .content \
#     | base64 -d \
#     | awk -f packages/firmware-flash/scripts/gen-board-names.awk \
#     > packages/firmware-flash/src/board-names.ts

BEGIN {
  print "// AUTO-GENERATED from ArduPilot Tools/AP_Bootloader/board_types.txt"
  print "// (https://github.com/ArduPilot/ardupilot/blob/master/Tools/AP_Bootloader/board_types.txt)"
  print "//"
  print "// Regenerate with the awk script in packages/firmware-flash/scripts/gen-board-names.awk."
  print ""
  print "/**"
  print " * Board id → friendly name lookup, built from ArduPilot ap_bootloader.cpp"
  print " * board_types.txt. Used to enrich error messages like \"Refusing to flash:"
  print " * built for board id 59 (ARK_FPV), connected board reports id 1013 (MATEKH743).\""
  print " * On id collision (e.g. FMU_V2/V3/CUBE_F4 all = 9) the FIRST entry in the"
  print " * source file wins; this map preserves that choice."
  print " */"
  print "export const BOARD_NAMES_BY_ID: Readonly<Record<number, string>> = Object.freeze({"
}

/^TARGET_HW_/ {
  name = $1; id = $2
  sub(/^TARGET_HW_/, "", name)
  if (id !~ /^[0-9]+$/) next
  if (!(id in seen)) { ids[++count] = id; names[id] = name; seen[id] = 1 }
}
/^AP_HW_/ {
  name = $1; id = $2
  sub(/^AP_HW_/, "", name)
  if (id !~ /^[0-9]+$/) next
  if (!(id in seen)) { ids[++count] = id; names[id] = name; seen[id] = 1 }
}

END {
  # Sort ids numerically — BSD awk has no asorti, so bubble it.
  for (i = 1; i <= count; i++) {
    for (j = i + 1; j <= count; j++) {
      if ((ids[i] + 0) > (ids[j] + 0)) { tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp }
    }
  }
  for (i = 1; i <= count; i++) {
    printf "  %s: \"%s\",\n", ids[i], names[ids[i]]
  }
  print "})"
  print ""
  print "/**"
  print " * Returns the canonical board name for an id, or undefined if unknown."
  print " * Wrap the bare number with this when surfacing to users:"
  print " *   `formatBoardId(59)` → \"59 (ARK_FPV)\""
  print " *   `formatBoardId(99999)` → \"99999\""
  print " */"
  print "export function formatBoardId(id: number): string {"
  print "  const name = BOARD_NAMES_BY_ID[id]"
  print "  return name ? `${id} (${name})` : String(id)"
  print "}"
}
