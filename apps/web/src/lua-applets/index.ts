// Bundled Lua applet source, imported as raw strings so the "Install" button on
// the Lua Scripts tab is one click — no network fetch, no CORS, works offline.
//
// GPL PROVENANCE (mandatory): every `.lua` in this directory is copied verbatim
// from ArduPilot's `libraries/AP_Scripting/applets/` (GPL-3.0-or-later), with a
// 4-line provenance header prepended noting its upstream path and license. Each
// catalog entry in `view-models/lua-scripts.ts` also carries `source` (upstream
// path) and `license` fields. ArduConfigurator is GPL-3.0-only, so redistributing
// these applets is compatible. Do NOT edit the applet bodies — keep them tracking
// upstream so behaviour on-vehicle matches the documented applet.
//
// The `?raw` suffix is a Vite feature (typed via `vite/client`) that inlines the
// file contents as a string at build time.

import advanceWp from './advance-wp.lua?raw'
import battEstimate from './BattEstimate.lua?raw'
import copterDeadreckonHome from './copter-deadreckon-home.lua?raw'
import copterTerrainBrake from './copter_terrain_brake.lua?raw'
import ledsOnASwitch from './leds_on_a_switch.lua?raw'
import motorFailureTest from './motor_failure_test.lua?raw'
import mountPoi from './mount-poi.lua?raw'
import revertParam from './revert_param.lua?raw'
import runcamOnArm from './runcam_on_arm.lua?raw'
import scriptController from './Script_Controller.lua?raw'
import smartAudio from './SmartAudio.lua?raw'
import winchControl from './winch-control.lua?raw'

/** Applet id (matches the catalog id in `view-models/lua-scripts.ts`) → `.lua` source. */
export const LUA_APPLET_CONTENTS: Readonly<Record<string, string>> = {
  'advance-wp': advanceWp,
  'batt-estimate': battEstimate,
  'deadreckon-home': copterDeadreckonHome,
  'terrain-brake': copterTerrainBrake,
  'leds-on-switch': ledsOnASwitch,
  'motor-failure-test': motorFailureTest,
  'mount-poi': mountPoi,
  'revert-param': revertParam,
  'runcam-on-arm': runcamOnArm,
  'script-controller': scriptController,
  smartaudio: smartAudio,
  'winch-control': winchControl
}
