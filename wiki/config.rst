Config
======

The **Config** tab holds the baseline settings that do not have their own tab
but that you still need on a fresh build: airframe geometry, board orientation,
RC and arming settings, and system identity/logging. Attached hardware (GPS,
compass, gimbal, rangefinder and optical flow) is on the
:doc:`first-time-setup/peripherals-gimbal` tab. Config edits the same
parameters as the :doc:`parameters` tab, grouped by task. It uses the same
edit → review → apply drafts as the rest of the app.

Category tabs
-------------

The settings are grouped into **category tabs** across the top, so you see one
area at a time:

- **Airframe & Powertrain:** frame class/type, board orientation, and the whole
  power train: ESC protocol, DShot rate, BLHeli, motor poles and reverse mask.
- **RC:** receiver protocol and options, and the RSSI source.
- **Flight Modes:** which mode each switch position selects, the mode channel
  itself, and the live position the vehicle reports.
- **Arming:** arming checks and arm/disarm behavior.
- **Power:** battery monitor, capacity, and the arming thresholds that depend
  on them, with live voltage and current.
- **System:** MAVLink identity, logging, and the **system rates** (main loop
  frequency, gyro rate, fast-sample mask), the **fast loop rate** (on Copter
  builds with the fast-rate thread), plus **active IMU** selection.

The **fast loop rate** card runs the rate (PID) controller in its own thread at
gyro rate ÷ ``FSTRATE_DIV`` (``ArduCopter/rate_thread.cpp``). You pick the
**PID loop rate** (at a 4 kHz gyro: 4, 2 or 1 kHz), and the app writes the
divisor. The choices follow ``INS_GYRO_RATE`` halving down to 1 kHz, within the
firmware's cap of gyro rate ÷ main loop rate. A divisor already set outside that
list stays selectable, shown as its rate. Only the roll, pitch and yaw rate
loops speed up. The altitude and position controllers still run in the main
loop at ``SCHED_LOOP_RATE``.

.. note::

   The beeper/LED card is on :doc:`first-time-setup/peripherals-gimbal`
   (**LEDs & Buzzer**), as one card, and the camera trigger is in that tab's
   **Camera & Gimbal** group, beside the mount that carries the camera. The
   main loop rate is a System setting and is not repeated on the ESC card.

A category holding a single card takes the full width and flows its fields into
as many columns as fit.

.. note::

   System rates and active-IMU selection are on **System**, because they set
   how hard the flight controller runs, not which sensors are attached. The GPS
   and compass settings are on :doc:`first-time-setup/peripherals-gimbal`, with
   the rest of the attached hardware.

Each card leads with the settings you use most. Rarely-touched fields (trims,
expo, boot delay, log bitmask, and the like) fold under a per-card
**Advanced (n)** disclosure. Click it to reveal them. A field with an unsaved
edit keeps its Advanced section open, and any category tab holding an unsaved
change is marked with a dot.

Board orientation preview
-------------------------

The **Board orientation** card (under *Airframe*) shows a small **3D picture of
the flight controller** as it is mounted, driven by the selected
``AHRS_ORIENTATION``. It reacts to the dropdown before you apply: a flat/yaw
orientation rotates the board, a 180° flip shows the board upside down, and an
on-its-side (Roll/Pitch 90) mount stands it on edge. Use it to confirm the
setting matches how the board is mounted. Custom orientations (set by explicit
angles) show a note instead of a posed board.

Compass
-------

The **Compass** card (on the :doc:`first-time-setup/peripherals-gimbal` tab)
collects the compass settings that are otherwise only in the raw parameter
tree: which compasses to use for yaw
(``COMPASS_USE`` / ``USE2`` / ``USE3``), auto declination, how the primary
external compass is mounted (``COMPASS_EXTERNAL``) and its orientation
(``COMPASS_ORIENT``, the same rotation set as the board orientation), the
auto-orientation check run during calibration (``COMPASS_AUTO_ROT``), and,
under Advanced, a mask of driver types to block (``COMPASS_DISBLMSK``).
ArduPilot auto-detects compasses. An internal one follows the board orientation.
An external one uses its own orientation, set here.

Applying changes
----------------

Edits stage as local drafts and do not touch the aircraft until you apply. The
**Apply Config** / **Revert** toolbar at the bottom covers the whole tab. One
press commits (or discards) every staged change across this tab's categories,
so you can edit several categories and apply once. Changes that need a reboot
prompt you to reboot afterward, as elsewhere in the app.
