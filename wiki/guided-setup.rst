Guided Setup
============

Guided Setup is the recommended path for a fresh vehicle. It is an ordered
checklist, and each step is checked against the live vehicle. Steps unlock in
sequence. You cannot sign off a step until the ones it depends on are met.

Where it is
-----------

Guided Setup is an Expert-mode tab with a *beta* badge, because its steps are
still being reworked to follow the rebuilt pages. Switch on Expert mode and it
appears last in the left navigation. The **Status & Info** tab also carries a **Guided setup**
card that names the next step and offers **Start Guided Setup** / **Resume
Setup** / **Review Setup**.

How it works
------------

The steps are listed down the side, the current one marked **Do this now**. Each
step shows:

- **What to do**: the instruction, with a *Still needed* list.
- **Next Action**: a button that takes you to the relevant tab (**Open Vehicle
  Link**, **Open Ports**, …) or starts a guided exercise.
- **Completion Criteria**: the checks that must pass ("Live RC telemetry is
  present", "RC endpoint capture completed"), each marked met or unmet, with an
  *n/m done* count.
- **Live Evidence**: a short readout of the live state the criteria are reading.

When every criterion is met and you confirm the step, it is marked complete and
the next one unlocks. **Previous Step** / **Continue to …** move along the list,
**Reset progress** clears every sign-off, and **Back to Setup** returns to the
Status & Info tab. Progress is kept in this browser.

The steps
---------

The steps run in bring-up order:

#. **Vehicle Link**: a healthy connection and a complete parameter sync.
#. **Ports**: serial protocols (RC input, telemetry, GPS, …). It flags a second
   RC-input port and a port receiving traffic it cannot decode (see
   :doc:`first-time-setup/ports-serial`).
#. **Airframe**: frame class and type.
#. **Outputs**: the ESC protocol, motor order and direction
   (:doc:`first-time-setup/outputs-motors`).
#. **Accelerometer Calibration**, **Level Calibration**, **Compass
   Calibration**: the three bench calibrations
   (:doc:`first-time-setup/sensors-calibration`).
#. **Radio**: map the channels, capture endpoints, and verify channel
   directions (:doc:`first-time-setup/receiver`).
#. **Motor Range**: ``MOT_SPIN_ARM`` / ``MOT_SPIN_MIN``, the armed idle and
   the least the motors spin in flight, measured props-off with the spin wizard
   in Motors ▸ Motor Setup. Analog ESCs calibrate their endpoints here too
   (:doc:`first-time-setup/outputs-motors`).
#. **Initial Tune**: the starting gains, filters and limits from the prop
   size and the pack (:ref:`initial-tune`), before the first flight.
#. **Flight Modes**: Stabilize and AltHold on the mode switch, verified by
   moving it (:doc:`first-time-setup/flight-modes`).
#. **Battery**: the battery monitor and its arming thresholds
   (:doc:`first-time-setup/power-battery`).
#. **Failsafe**: radio, battery and GCS failsafe behaviour
   (:doc:`first-time-setup/failsafe`). A Copter without GPS is asked to land
   on signal loss instead of returning.
#. **Ready to Fly**: the last check before props go on. Every arming check
   is enabled, logging is on, there is a way to arm, pre-arm is clear with the
   pack connected, and a snapshot is saved. It hands off to the first flight.
#. **Maiden Hover**: the first flight, read from its log. It checks: armed in
   Stabilize, the disarm rehearsed, a short hover held, no rate-loop
   oscillation, acceptable vibration, nothing reported by the firmware. Read
   the log from disk or directly from the vehicle.
#. **Hover Throttle**: a steady hover in AltHold learns ``MOT_THST_HOVER``.
   Accept it (this freezes learning), then set the vertical acceleration
   controller from it: ``PSC_D_ACC_P`` = 0.1 × and ``PSC_D_ACC_I`` = 0.2 ×
   hover throttle; on 4.6 the names are ``PSC_ACCZ_P`` / ``PSC_ACCZ_I`` at ten
   times the scale. See :doc:`first-time-setup/sensors-calibration`.
#. **Filters**: the harmonic notch, placed from the hover log before any
   tuning. With ESC telemetry the notch tracks the motors: mode 3, reference 1,
   floor below the hover frequency and above the gyro filter. Without it the
   notch follows throttle: mode 1, reference = hover throttle, centre on the
   hover's gyro peak. Bandwidth is half the frequency, a quarter with per-motor
   notches. A verification hover with post-filter logging follows
   (:doc:`tuning`).
#. **Autotune**: one axis at a time in AltHold on a calm day, once the hover
   throttle is learned, the notch is on and ``AUTOTUNE_AGGR`` sits between
   0.05 and 0.10. The step records the gains the flight starts from and calls
   an axis tuned when its gains moved. The card after the tune offers
   ``ATC_THR_MIX_MAX`` 0.9 (:doc:`tuning`).

.. note::

   The step list adapts to the vehicle and to what the firmware exposes. Plane,
   Rover and Sub get the steps that apply to them.

.. warning::

   Guided Setup verifies configuration, not airworthiness. Do a props-off
   check, confirm motor order and direction, and follow the
   `ArduPilot first-flight guidance <https://ardupilot.org/copter/docs/flying-arducopter.html>`__
   before any powered flight.

Channel-direction gate
----------------------

The **Radio** step blocks sign-off until every primary axis (roll, pitch,
throttle, yaw) reads the correct direction. Move each stick the way it is
labelled; the Receiver page's **Direction** column reads *correct* or *backwards,
tick Reverse* for each. Tick **Reverse** on a backwards axis. See
:doc:`first-time-setup/receiver`.
