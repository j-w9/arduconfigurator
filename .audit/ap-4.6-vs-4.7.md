# ArduCopter parameter delta: 4.6 → 4.7 (+ 4.8-dev notes)

Read-only audit. No configurator source was modified.

## Version pinning

| Slot | Ref | Commit | Notes |
|---|---|---|---|
| 4.6 (stable) | tag `Copter-4.6.3` | `92b0cd788e` | latest 4.6.x stable |
| 4.7 | branch `origin/ArduPilot-4.7` | `97775f82ce` (`Plane: version to 4.7.0-beta7`) | **No `Copter-4.7.x` stable tag exists yet** — 4.7 is still in beta. This is the closest authoritative 4.7 source. |
| 4.8-dev | `master` | `e080acb225` | for distinguishing master-only churn |

Param lists generated with `Tools/autotest/param_metadata/param_parse.py --vehicle ArduCopter --format json` in non-destructive `git worktree`s (`/tmp/ap46`, `/tmp/ap47`, `/tmp/ap48`), then flattened (leaf key = full param name). Configurator curated set: `arducopterMetadata.parameters` from `packages/param-metadata/dist/index.js` → **563 params**.

> Caveat on totals: `param_parse --vehicle ArduCopter` emits the full library union the Copter build can reference (airspeed, autorotation, etc.), so raw totals (~4.8k→5.7k) and the bulk add/remove/rename counts are dominated by library/noise params that ArduCopter never streams. The **curated cross-reference below is the signal**; the raw counts are context only.

## Headline counts — 4.6 → 4.7

| Class | Raw (full library union) | Intersecting the 563 curated params |
|---|---|---|
| Added | 1129 | **10** |
| Removed | 217 | **7** |
| Renamed (strict: same DisplayName+Description) | 1599 | 4 (others missed by heuristic — see Section A) |
| Values (enum) changed | 214 | **51** |
| Bitmask changed | 53 | **11** |
| Range changed | 237 | **17** |
| Default changed | 0 (Default not emitted in this pdef build) | 0 |

The raw counts are inflated by param_parse pulling in the whole library set and by a loose DisplayName-based rename heuristic; treat them as noise. **What matters is the curated intersection, detailed in Section A.**

---

## Section A — changes that affect curated configurator params (ACTIONABLE)

### A1. Renames already handled ✅ (no action)

These are unit/semantics-changing renames the configurator already covers, either by dual-curating both names (the `ANGLE_MAX` pattern) or via the `LEGACY_PARAM_ALIASES` map in `packages/ardupilot-core/src/runtime.ts`.

| 4.6 name | 4.7 name | Unit change | How handled | Verified |
|---|---|---|---|---|
| `ANGLE_MAX` | `ATC_ANGLE_MAX` | cdeg → deg | Dual-curated (`arducopter.ts` ~1652/1663). Not aliased (value-changing). | source-confirmed |
| `ATC_ACCEL_R_MAX` | `ATC_ACC_R_MAX` | cd/s² → deg/s² | Dual-curated (~2254–2298). Not aliased. | pdef rename |
| `ATC_ACCEL_P_MAX` | `ATC_ACC_P_MAX` | cd/s² → deg/s² | Dual-curated. Not aliased. | pdef rename |
| `ATC_ACCEL_Y_MAX` | `ATC_ACC_Y_MAX` | cd/s² → deg/s² | Dual-curated. Not aliased. | pdef rename |
| `SYSID_THISMAV` | `MAV_SYSID` | none | Dual-curated **and** aliased (`runtime.ts:237`). | source-confirmed |
| `SYSID_MYGCS` | `MAV_GCS_SYSID` | none | Dual-curated **and** aliased (`runtime.ts:238`). | source-confirmed |
| `MODE_CH` | `FLTMODE_CH` | none | Aliased (`runtime.ts`); legacy curated. | known-handled |
| `GPS_TYPE` family | `GPS1_TYPE` family | none | Aliased (`runtime.ts:218`). | recently fixed |

**Minor doc staleness (not functional):** the descriptions for `SYSID_*`/`MAV_*` and `ATC_ACCEL_*`/`ATC_ACC_*` still say *"ArduPilot master renamed… rename not yet in stable as of 4.6."* As of 4.7-beta these renames are now in the 4.7 release line, not master-only. Wording could be updated to "4.7+", but behavior is correct.

### A2. NOT handled — needs action 🔴

#### 1. `ARMING_CHECK` → `ARMING_SKIPCHK` — inverted semantics (highest impact)
- **4.6:** `ARMING_CHECK` ("Arm Checks to **Perform**", `checks_to_perform`, default `ARMING_CHECK_ALL`, bit 0 = "All", bits 1–19 = individual checks). Source: `AP_Arming.cpp:164` `AP_GROUPINFO("CHECK", …)`.
- **4.7:** `ARMING_CHECK` is **gone**, replaced by `ARMING_SKIPCHK` ("Arm Checks to **Skip**", `checks_to_skip`, default `0`, **no "All" bit** — bits 1–19 = checks to skip). Source: `AP_Arming.cpp:201` `AP_GROUPINFO("SKIPCHK", …)`.
- **Configurator state:** `ARMING_CHECK` is curated (`arducopter.ts:1798`, bit labels `ARDUCOPTER_ARMING_CHECK_BIT_LABELS` in `arducopter-enums.ts:379`) and **wired into a config section** (`apps/web/src/hooks/use-config-sections.ts:172–174`, copy: *"ARMING_CHECK = 1 enables all checks; specific bits disable individual checks"*). `ARMING_SKIPCHK` is **not curated**.
- **Why no alias works:** the value meaning is *inverted* (perform → skip) and bit 0 ("All") was dropped, so mirroring the raw value would be actively wrong. This must NOT go in `LEGACY_PARAM_ALIASES` (which is correctly restricted to same-unit/same-range renames).
- **What to do:** curate `ARMING_SKIPCHK` as its own param (bitmask of checks to skip, bits 1–19, no "All", default 0), update the Arming config section to drive `ARMING_SKIPCHK` on 4.7+ while keeping `ARMING_CHECK` for ≤4.6, and fix the section copy (the "=1 enables all" mental model is reversed under SKIPCHK). On 4.7 hardware the current Arming UI will bind to nothing.
- ArduCopter byte-identical: additive curation + version-gated UI; ≤4.6 path stays `ARMING_CHECK`.

#### 2. Rangefinder range params: cm → m rename (reverse of the ANGLE_MAX gap)
- `RNGFND{n}_MIN_CM` (cm) → `RNGFND{n}_MIN` (m); `RNGFND{n}_MAX_CM` → `RNGFND{n}_MAX`; `RNGFND{n}_GNDCLEAR` (cm) → `RNGFND{n}_GNDCLR` (m). Source-confirmed in `AP_RangeFinder_Params.cpp` (4.6 `@Param: MIN_CM/MAX_CM/GNDCLEAR`; 4.7 `@Param: MIN/MAX/GNDCLR`).
- **Configurator state:** `buildRangefinderParameterDefinitions` (`shared-rangefinder.ts`) curates only the **new 4.7 names in meters** (`RNGFND1_MIN`, `RNGFND1_MAX`, `RNGFND1_GNDCLR`). The legacy `_CM`/`GNDCLEAR` names are **not** curated and **not** aliased.
- **Impact:** on the 4.6 trust-anchor hardware, the FC streams `RNGFND1_MIN_CM` etc.; the curated meter-named fields won't bind, so Rangefinder Min/Max/Ground-clearance fall through to the raw Parameters view on 4.6. (On 4.7 it's correct.) This is the mirror image of the `ANGLE_MAX` handling — it wants the same dual-curation treatment (legacy `_CM`/`GNDCLEAR` in cm + new names in m). Cannot be aliased (unit-changing).
- Applies to whichever RNGFND instances the configurator curates (currently instance 1, and 2 where built).

#### 3. `BATT_MONITOR` — new backend enum values missing
- 4.7 adds `30 = INA3221`, `31 = Analog Current Only`, `32 = TIBQ76952-I2C (Periph only)`, and expands the `21` label to `INA2XX (INA226 INA228 INA238 INA231 INA260)`.
- **Configurator state:** `BATT_MONITOR` is curated but its option list **lacks 30/31/32** (label 21 still the short "INA2XX"). On a 4.7 FC using one of these monitors the dropdown shows a raw number. Additive option fix.

#### 4. `FS_EKF_ACTION` — new value `0` + relabels
- 4.7 adds `0 = Report only` and rewords `1/2/3` ("Switch to Land/AltHold mode if current mode requires position", "Switch to Land mode from all modes").
- **Configurator state:** options are `1=Land, 2=AltHold, 3=Land Even In Stabilize` — **missing `0`** and using the pre-4.7 wording. Add `0` and refresh labels.

### A3. Curated enum/value changes already covered ✅ (spot-checked, no action)

The configurator appears curated ahead of 4.7 (against master) for most enums:

| Param | 4.7 change | Curated? |
|---|---|---|
| `RNGFND1_TYPE` | +45 LightWare-GRF, +46 BenewakeTFS20L, +47 DTS6012M, +48 LightWare-GRF-I2C; relabel 20→BenewakeTFmini-Serial, 25→BenewakeTFmini-I2C | ✅ all present, new labels |
| `MNT1_TYPE` / `MNT2_TYPE` | +14 XFRobot; 6→"MAVLink (Gremsy/AVT)" | ✅ |
| `GPS_AUTO_CONFIG` | +3 "Clear all configurations…" | ✅ |
| `SERIALn_PROTOCOL` | +50 IOMCU | ✅ |
| `SERVOn_FUNCTION` | +160–179 Motor13…Motor32 | ✅ (max 179) |
| `MNT1_OPTIONS`/`MNT2_OPTIONS` | bitmask +bit1 (RC-FS neutral), +bit2 (force FPV lock) | n/a — curated as a raw bitmask (no per-bit labels), so unaffected |
| `NTF_LED_TYPES` | +bit19 ProfiLED_IOMCU | curated as raw bitmask flag; unaffected |
| `AUTOTUNE_GMBK` | **new param in 4.7** | ✅ already curated (configurator was ahead) |

### A4. Cosmetic label drift on curated failsafe params (low priority)

4.7 reworded several failsafe-action labels; the configurator carries the pre-4.7 text. Functionally harmless (same values), but the dropdown labels read slightly stale vs the wiki:
- `FS_THR_ENABLE` / `FS_GCS_ENABLE`: value `6` 4.7 = "…Auto DO_LAND_START**/DO_RETURN_PATH_START** or RTL" (configurator: "Auto DO_LAND_START or RTL").
- `BATT_FS_LOW_ACT` / `BATT_FS_CRT_ACT`: value `0` 4.7 = "Warn only" (configurator: "None"); value `6` same DO_RETURN_PATH_START addition.

### A5. Curated range changes (mostly metadata-only)

17 curated params changed `@Range` between 4.6 and 4.7. Most are 4.7 simply *adding* a range that 4.6 lacked (e.g. `SERIALn_BAUD` → 1..20000000, `MOT_SPIN_ARM/MIN/MAX`, `RNGFND1_PIN/STOP_PIN`, `FS_EKF_THRESH` → 0..1). Two are genuine tightenings worth a glance vs the configurator's own min/max: `LOG_FILE_MB_FREE` 10..1000 → **2**..1000, and `RC_FS_TIMEOUT` 0.5..10 → **0.1**..10. These only matter if the configurator clamps user input to its curated min/max; otherwise informational.

---

## Section B — notable 4.7 changes NOT in the curated set (decide whether to expose)

These are 4.7-stable additions that ArduCopter can stream but the configurator does not curate (they only appear in the raw Parameters view today):

- **`SERIALn_OPTIONS` bit reshuffle → new `MAVn_OPTIONS` family.** 4.7 relabels `SERIALn_OPTIONS` bits 10 ("Don't forward mavlink") and 12 ("Ignore Streamrate") as *"(moved to MAVn_OPTIONS >4.7)"* and introduces a new `MAV1_*`/`MAV2_*`… options family. If the configurator ever exposes per-bit serial options or MAVLink-forwarding controls, this is the relevant move. (Configurator currently treats `SERIALn_OPTIONS` as a raw bitmask, so no immediate break.)
- **`AROT_FWD_*` / `AROT_XY_ACC_MAX`** — expanded autorotation controller (helis; likely out of FPV-copter scope).
- **`ALAND_*`** (autoland), **`AHRS_ORIG_*`** (origin lat/lon/alt, alongside legacy `AHRS_ORIGIN_*`), **`ARM_C_RTL_ALT_M`**, **`ARMING_SKIPCHK`** (see A2), **`ARMING_NEED_LOC`**.
- **Multi-sensor families fleshed out**: `ARSPD3_*`/`ARSPD4_*` (airspeed — not typical on copter), additional INA battery backends (A3).
- Many of the ~1100 "added" entries are non-Copter library params (Plane/airspeed/scripting) that param_parse lists but ArduCopter never streams — not worth surfacing.

---

## 4.7 → 4.8-dev (master) — labeled separately, do NOT treat as 4.7

Master churn since 4.7 is small and mostly heli/SIM:
- **Added:** `BARO_THST_FILT`, `DDS_USE_NS`, `H_SW_PHANG`, `H_SW2_PHANG` (heli swashplate), `SIM_GPS{1..4}_FIXTYPE`.
- **Removed:** `H_FLYBAR_MODE`, `H_GYR_GAIN`, `H_GYR_GAIN_ACRO`, `H_SW_H3_PHANG`, `H_SW2_H3_PHANG` (heli).
- **Curated-affecting enum tweaks (master only):** `RNGFND{n}_TYPE` **drops `48` (LightWare-GRF-I2C)** again on master; `TUNE`/`TUNE2` swap value `13`→`61`; `EK3_MAG_CAL` +7; `H_TAIL_TYPE` −1.
- None of these are in 4.7 — if/when the configurator targets 4.8 the RNGFND `48` and `TUNE` `13`↔`61` changes will need attention, but they are out of scope for a 4.6→4.7 pass.

---

## Verification notes / uncertainties

- **No `Copter-4.7.x` stable tag exists** (latest stable is `Copter-4.6.3`). "4.7" here = `ArduPilot-4.7` branch at `4.7.0-beta7`. Enum/range details could still shift before 4.7.0 final; re-run against the GA tag when it lands. The structural renames (`ARMING_SKIPCHK`, RNGFND cm→m, `ATC_ACCEL→ATC_ACC`, `ANGLE_MAX→ATC_ANGLE_MAX`, `SYSID→MAV_*`) are well-settled and source-confirmed, so they will not regress.
- `param_parse.py` `--vehicle ArduCopter` did **not** filter to Copter-only params; it emitted the full library union (no `Q_*` quadplane params, but plenty of Plane/airspeed/scripting noise). Raw add/remove/rename totals are therefore inflated; the curated cross-reference is the trustworthy layer.
- `Default` was absent from this pdef build (`param_parse` JSON didn't carry it on these refs), so the "default changed" axis could not be computed (reported 0 — that's "not measured", not "no changes").
- The strict rename heuristic (DisplayName **and** Description match) deliberately missed `ARMING_CHECK→ARMING_SKIPCHK` (different DisplayName), `SYSID_*→MAV_*`, and `RNGFND_*_CM→_*` (Description/Units changed) — all recovered manually and source-verified above.
- Source-confirmed against C++ (not just pdef): `ARMING_CHECK`/`SKIPCHK` (`AP_Arming.cpp`), RNGFND `MIN_CM/MAX_CM/GNDCLEAR → MIN/MAX/GNDCLR` (`AP_RangeFinder_Params.cpp`), `ANGLE_MAX → ATC_ANGLE_MAX`.
