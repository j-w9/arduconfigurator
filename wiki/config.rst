Setup
=====

The **Setup** tab holds the baseline settings that do not have their own tab
but that you still need on a fresh build: airframe geometry, board orientation,
RC and arming settings, and system identity/logging. Attached hardware (GPS,
compass, gimbal, rangefinder and optical flow) is on the
:doc:`first-time-setup/peripherals-gimbal` tab. Setup edits the same
parameters as the :doc:`parameters` tab, grouped by task. It uses the same
edit → review → apply drafts as the rest of the app.

Category tabs
-------------

The settings are grouped into **category tabs** across the top, so you see one
area at a time:

- **Airframe & Powertrain**: frame class/type, board orientation, and the whole
  power train: ESC protocol, DShot rate, BLHeli, motor poles and reverse mask.
- **Initial Tune** (Copter): a starting point for a new build from its prop
  size and battery. See :ref:`initial-tune` below.
- **Calibration**: the bench calibrations (accelerometer, level, compass,
  thermal, battery voltage and current, ESC throttle range). See
  :doc:`first-time-setup/sensors-calibration`.
- **RC & Arming**: receiver protocol and options, the RSSI source, arming
  checks and arm/disarm behavior. Flight modes are on the
  :doc:`first-time-setup/receiver` tab.
- **System**: the **Battery** card (battery monitor, capacity, and the arming
  thresholds that depend on them, with live voltage and current), the **system
  rates** (main loop frequency, gyro rate, and the
  per-IMU fast-sample mask ``INS_FAST_SAMPLE``), the **fast loop rate** (on
  Copter builds with the fast-rate thread), **active IMU** selection, and
  **system identity** (MAVLink ids, boot delay). The log backend, retention and
  bitmask are on the :doc:`Logs <logs-inspectors>` tab, beside the logs they
  produce.

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
   (**LEDs & Buzzer**), the camera trigger under its **Camera & Gimbal** group.

A category holding a single card takes the full width and flows its fields into
as many columns as fit.

Every field of a card is shown. There are no per-card *Advanced* folds. Each
card has one heading, and each field's explanation is behind its **i**. Any
category tab holding an unsaved change is marked with a dot.

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
**Apply Config (n)** / **Revert** bar at the bottom is the only apply bar on the
page. One press commits (or discards) every staged change across this tab's
categories, the Power card included. Changes that need a reboot prompt you to
reboot afterward, as elsewhere in the app.

.. _initial-tune:

Initial Tune
------------

**Initial Tune** works out a starting point for a *new* airframe from three
facts about it: prop diameter, battery cell count and cell chemistry. It stages
the parameters that follow from them. Start a fresh build here, before there is
anything worth autotuning. The preview lists each change by name (raw id beside
it) in the same units as the Pilot task, grouped Stick feel, Filters, Motors,
Battery, and Failsafes & fence.

It uses the same formulas as Mission Planner's *Initial Parameters* screen, so
the numbers match what that tool gives, with two corrections noted below.

In the default mode it asks only those three questions and then stages the
result. The parameter-by-parameter working is an **Expert** view, as are the
two option checkboxes (**T-Motor ESCs**, **Failsafes & fence**). The button
shows the count of what will be staged in either mode (**Stage n changes**).
Nothing is written until you **Write all** from the draft bar.

What it sets, all driven by prop size or the pack:

- ``INS_GYRO_FILTER`` and ``INS_ACCEL_FILTER``, plus the matching
  ``ATC_RAT_*_FLT*`` rate-loop filters. Bigger props get lower cutoffs.
- ``ATC_ACCEL_{R,P,Y}_MAX`` acceleration limits and the acro yaw rate.
  ArduCopter 4.2 replaced ``ACRO_YAW_P`` with ``ACRO_Y_RATE`` (converted with a
  ×45 factor), so ``ACRO_Y_RATE`` is what gets staged. The old name is used
  only on a vehicle that still reports it.
- ``MOT_THST_EXPO`` and a ``MOT_THST_HOVER`` starting guess.
- ``BATT_ARM_VOLT`` / ``BATT_CRT_VOLT`` / ``BATT_LOW_VOLT`` and
  ``MOT_BAT_VOLT_MIN`` / ``MAX`` from the cell count and chemistry. Four
  chemistries are offered: **LiPo** (4.2 V/cell full, 3.3 V empty), **LiPo
  HV** (4.35 / 3.3), **Li-ion** (4.2 / 2.7) and **Li-ion HV** (4.35 / 2.7).
  Mission Planner's 4.1 V / 2.8 V for Li-ion is neither the cell's charge
  voltage nor its discharge floor. These values set the range the thrust
  compensation scales across, so a tenth of a volt per cell matters from the
  moment the pack comes off the charger.

Two options change the result. **T-Motor ESCs** flattens the thrust curve to a
fixed expo and pins the PWM range. **Failsafes & fence** adds the suggested
battery-failsafe actions plus a 120 m / 150 m fence.

.. important::

   **It sets no PID gains.** Prop diameter says nothing about P, I or D, so
   ``ATC_RAT_*_P/I/D`` are left as they are. This gets an airframe to a first
   hover that is safe to fly. **Autotune** and **Log Tuning** do the tuning
   from there.

.. admonition:: Example: a 9-inch quad on 4S LiPo

   Prop **9**, cells **4**, **LiPo**, against the demo vehicle's values (nine of
   the fourteen rows):

   ==================  =========================  ========  ========
   Group               Setting                    Now       New
   ==================  =========================  ========  ========
   Stick feel          Roll / pitch accel limit   1409      1259 °/s²
   Stick feel          Yaw accel limit            293       279 °/s²
   Stick feel          Acro yaw rate              240       139.5 °/s
   Filters             Gyro filter                40        46 Hz
   Filters             Roll / pitch D filter      35        23 Hz
   Filters             Yaw D filter               0         11.5 Hz
   Motors              Hover throttle             0.35      0.2
   Battery             Arm voltage                13.8      14.7 V
   Battery             Critical voltage           13.8      14 V
   ==================  =========================  ========  ========

   **Stage 14 changes** puts them in the draft bar. Nothing is written until
   **Write all**.

The table lists only the values that would change. Each row shows what the
vehicle has now next to what it would become, with the reasoning on hover. A
parameter the connected vehicle does not report is left out, because it could
only stage as invalid, and one invalid row blocks the whole batch. Nothing is
written here: **Stage n changes** puts the batch into the same draft bar as
every other tuning change, and you write it there.
