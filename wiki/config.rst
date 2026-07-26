Config
======

The **Config** tab is the baseline-settings surface — the "everything else"
knobs that don't warrant their own tab but that you still reach for on a fresh
build: airframe geometry, board orientation, compass, GPS behavior, RC and
arming settings, and system identity/logging. It edits the same parameters the
:doc:`parameters` tab exposes, but grouped into a product-shaped layout with the
staged-draft workflow used across the app (edit → review → apply).

Category tabs
-------------

The settings are grouped into five **category tabs** across the top, so you only
see one area at a time instead of a wall of cards:

- **Airframe** — frame class/type, board orientation, and the ESC/DShot protocol.
- **Sensors** — compass, active IMUs, and the system (loop/gyro) rates.
- **GPS** — GPS driver, auto-config, update rate, and multi-GPS behavior.
- **RC & Arming** — RSSI/mode-channel and RC settings, arming checks and
  arm/disarm behavior, and the pilot stick rates.
- **System** — MAVLink identity, logging, the beeper/LED, and camera trigger.

Each card leads with the settings you actually reach for; rarely-touched fields
(trims, expo, boot delay, log bitmask, and the like) fold under a per-card
**Advanced (n)** disclosure — click it to reveal them. A field with an unsaved
edit keeps its Advanced section open, and any category tab holding an unsaved
change is marked with a dot.

Board orientation preview
-------------------------

The **Board orientation** card (under *Airframe*) shows a small **3D picture of
the flight controller** as it is mounted, driven by the selected
``AHRS_ORIENTATION``. It reacts to the dropdown before you apply: a flat/yaw
orientation rotates the board, a 180° flip shows the board upside down, and an
on-its-side (Roll/Pitch 90) mount stands it on edge — so you can confirm the
mounting matches reality rather than reading an enum value. Custom orientations
(set by explicit angles) show a note instead of a posed board.

Compass
-------

The **Compass** card (under *Sensors*) collects the compass settings ArduPilot
otherwise leaves in the raw parameter tree: which compasses to use for yaw
(``COMPASS_USE`` / ``USE2`` / ``USE3``), auto declination, how the primary
external compass is mounted (``COMPASS_EXTERNAL``) and its orientation
(``COMPASS_ORIENT``, the same rotation set as the board orientation), the
auto-orientation check run during calibration (``COMPASS_AUTO_ROT``), and —
under Advanced — a mask of driver types to block (``COMPASS_DISBLMSK``).
ArduPilot auto-detects compasses; an internal one follows the board orientation,
while an external one uses its own orientation set here.

Applying changes
----------------

Edits stage as local drafts and don't touch the aircraft until you apply. The
**Apply Config** / **Revert** toolbar at the bottom is global to the tab — it
commits (or discards) every staged change across all five category tabs in one
press, so you can range across categories and apply once. Reboot-sensitive
changes prompt you to reboot afterward, the same as elsewhere in the app.
