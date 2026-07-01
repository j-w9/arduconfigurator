Guided Setup
============

The **guided setup** is the recommended path for a fresh vehicle. It presents the
first-time configuration as an ordered checklist, and — crucially — verifies each
step against the **live vehicle** rather than just telling you what to do. Steps
unlock in sequence: you can't sign off a later step until the ones it depends on
are satisfied.

How it works
------------

Each step shows:

- **Criteria** — the concrete checks that must pass (e.g. "Live RC telemetry is
  present", "RC endpoint capture completed"), each marked met or unmet.
- **Actions** — buttons that take you to the relevant tab, start a guided
  exercise, or confirm the step.
- **Evidence** — a short readout of the live state the criteria are reading.

When every criterion is met and you confirm the step, it's marked complete and
the next one unlocks.

The steps
---------

The guided flow follows the same order as a real bring-up:

#. **Link** — confirm a healthy connection and parameter sync.
#. **Ports** — assign serial protocols (RC input, telemetry, GPS, etc.).
#. **Receiver** — map channels, verify stick travel, capture endpoints, and
   **verify channel directions** (see :doc:`first-time-setup/receiver`).
#. **Outputs / Motors** — set the ESC protocol and check motor order and
   direction.
#. **Power / Battery** — configure the battery monitor and voltage/current
   calibration.
#. **Sensors** — accelerometer, compass, and level calibration.
#. **Flight Modes** — assign modes to a transmitter switch.
#. **Failsafe** — set radio and battery failsafe behavior.

.. note::

   The exact step list adapts to the vehicle and to what your firmware exposes.
   Plane, Rover, and Sub surface the steps relevant to them.

.. warning::

   Guided setup verifies configuration, not airworthiness. Always do a careful
   props-off check, confirm motor order and direction, and follow the
   `ArduPilot first-flight guidance <https://ardupilot.org/copter/docs/flying-arducopter.html>`__
   before any powered flight.

Channel-direction gate
----------------------

The **Receiver** step blocks sign-off until every primary axis (roll, pitch,
throttle, yaw) reads the correct direction. Move each stick the way it's labelled
in the Endpoints **Channel direction** check; any axis that reads backwards gets a
one-click reverse. See :doc:`first-time-setup/receiver`.
