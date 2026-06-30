Sensors and Calibration
=======================

The **Sensors** (Calibration) tab calibrates the inertial sensors and compass so
the autopilot knows which way is up and where it is pointing. It runs each
calibration as a *guided action*: you press one button and the app walks the
flight controller through the procedure live, sending the MAVLink commands and
watching the vehicle's replies. Three cards sit at the top — **Accelerometer**,
**Level**, and **Compass** — followed by the conditional calibrations (battery
voltage/current, airspeed on Plane, ESC on Copter).

.. warning::

   Calibrations send real commands to a real vehicle. Keep the props off, the
   vehicle disarmed, and the area clear. The app blocks each action while the
   vehicle is armed, while a motor test is running, or before the parameters
   have finished syncing.

.. contents:: On this page
   :local:
   :depth: 1

Accelerometer (six-position)
----------------------------

Full accelerometer calibration captures the vehicle in six orientations so
ArduPilot can solve the per-axis offsets and scales. Press **Calibrate
Accelerometer**; the app then prompts you through each pose in turn — *level*,
*left side*, *right side*, *nose down*, *nose up*, and *on its back* — and the
button relabels itself to the current pose (for example **Confirm Level
Position**). A pose graphic and the live roll/pitch readout help you set each
orientation. Hold the vehicle still, then press the confirm button to advance to
the next pose.

Under the hood the app sends ``MAV_CMD_PREFLIGHT_CALIBRATION`` (param5 = 1) to
start, and acknowledges each pose as ArduPilot requests it. The first (level)
pose sets your flying-attitude reference and must be as flat as you can manage;
the other five only need to be within about 20° of exact, as long as the vehicle
is steady.

.. note::

   There is no MAVLink abort for accelerometer calibration. Pressing **Cancel**
   stops the app from tracking the procedure, but the flight controller keeps
   waiting for poses until it times out or you reboot it. Repeat the calibration
   whenever you change the board's mounting orientation.

Level (AHRS trim)
-----------------

The **Calibrate Level** action runs a quick board-level trim: set the vehicle on
the bench in its normal flying attitude, press the button, and the flight
controller samples gravity for about a second to store the mounting tilt into
``AHRS_TRIM_X`` (roll) and ``AHRS_TRIM_Y`` (pitch). It sends
``MAV_CMD_PREFLIGHT_CALIBRATION`` with param5 = 2.

This is the fast way to square up a frame that sits slightly off-level — but it
only corrects up to about 10° of tilt and only on roll and pitch, so it
complements, rather than replaces, the full six-position calibration above.

Compass
-------

The **Calibrate Compass** action runs ArduPilot's onboard magnetometer
calibration: press the button, then slowly rotate the vehicle through all axes
(nose, tail, each side, top, and bottom pointed at the ground in turn) while the
app shows a live percentage. It sends ``MAV_CMD_DO_START_MAG_CAL`` across all
compasses with auto-save enabled, watches the ``MAG_CAL_PROGRESS`` and
``MAG_CAL_REPORT`` messages, and writes the resulting ``COMPASS_OFS_X/Y/Z``
offsets on success. **Cancel calibration** sends ``MAV_CMD_DO_CANCEL_MAG_CAL`` to
relax the routine, and a watchdog cancels automatically if the vehicle stops
reporting.

.. note::

   If the app reports a *bad orientation*, your board or compass orientation is
   wrong — check ``AHRS_ORIENTATION`` (and any external-compass orientation)
   before retrying. Calibration needs at least one enabled compass; if none is
   detected the action is blocked with a prompt to enable one or skip the step.

With and without GPS
~~~~~~~~~~~~~~~~~~~~~

Onboard compass calibration normally needs a GPS position to settle. The compass
card includes a **Set location (no GPS)** control for vehicles with no GPS
attached: pick a point on the map (or **Use my location**) and **Start fake
GPS**, and the app temporarily switches the GPS backend to *MAV* (``GPS1_TYPE``
= 14) and streams synthetic ``GPS_INPUT`` so the calibration can complete.
**Stop fake GPS** restores your original ``GPS1_TYPE``. With a real GPS fix you
can skip this and calibrate directly.

.. warning::

   Calibrate well away from steel, magnets, speakers, and current-carrying
   wires. Magnetic interference is the most common cause of a failed or
   wandering compass calibration. The app does not expose a "large vehicle"
   (GPS-heading) magnetometer calibration — use the rotate-through-all-axes
   procedure above.

See also the ArduPilot wiki: `Accelerometer Calibration
<https://ardupilot.org/copter/docs/common-accelerometer-calibration.html>`_ and
`Compass Calibration
<https://ardupilot.org/copter/docs/common-compass-calibration-in-mission-planner.html>`_.
