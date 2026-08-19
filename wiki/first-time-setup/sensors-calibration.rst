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

Battery voltage and current
---------------------------

An analog power module does not measure volts and amps — it measures a voltage
on two flight-controller pins, and ArduPilot converts each one with a scale
factor you have to set. Out of the box those factors are a guess for a generic
brick, which is why a fresh build so often reads a 6S pack as 21 V, or claims
55 A in a hover. Everything downstream — the OSD, the remaining-capacity
estimate, and the battery failsafe on the :doc:`failsafe` tab — is only as good
as these two numbers.

The **Battery voltage** and **Battery current** cards on this tab calibrate
them against a meter.

Voltage
~~~~~~~

ArduPilot computes pack voltage as the sensing pin's voltage multiplied by
:param:`BATT_VOLT_MULT`. Calibrating it is one measurement:

#. Connect a charged pack and read its voltage at the balance lead or the XT
   connector with a multimeter.
#. In **Calibration → Battery voltage**, compare the meter against the *FC
   reads* pill and enter the meter's figure in **Measured voltage (V)**.
#. The card shows the **new multiplier** it will write — your current multiplier
   scaled by measured ÷ reported — and **Apply voltage calibration** writes
   :param:`BATT_VOLT_MULT`.

Repeat the reading afterwards to confirm the two now agree. If they do not track
each other across a range — right at full charge, wrong at storage charge — the
problem is the sensing divider or a bad ground, not the multiplier.

Current
~~~~~~~

ArduPilot computes current as

   ``amps = (sensing_pin_voltage − BATT_AMP_OFFSET) × BATT_AMP_PERVLT``

so there are two numbers, and they do different jobs.
:param:`BATT_AMP_OFFSET` is the sensor's output **at zero current** — a
hall-effect sensor rarely sits at exactly 0 V — and :param:`BATT_AMP_PERVLT` is
the sensor's **gain**: how many amps a one-volt change on that pin represents.
An offset error puts a constant bias on every reading; a gain error scales with
throttle. Fix the offset first, or you will fold it into the gain.

The card appears only for the analog current monitors — :param:`BATT_MONITOR`
values 4 (*Analog Voltage and Current*), 25 (*Synthetic Current and Analog
Voltage*), 28 (*AD7091R5*) and 31 (*Analog Current Only*). A DroneCAN, ESC, or
smart battery reports amps directly and needs none of this.

.. warning::

   Calibrating current means drawing real current. **Props off**, vehicle
   restrained, and clear of the frame. The card gates its motor-spin control
   behind explicit props-removed and area-clear acknowledgements, and refuses
   while the vehicle is armed — do not work around that.

#. **Zero the offset.** With the pack connected and nothing drawing current,
   enter what your meter reads (0 A with the pack off) and press **Set offset**.
   It writes the :param:`BATT_AMP_OFFSET` that makes the present reading match.
#. **Draw a known load.** Clamp an ammeter on the pack lead. On Copter the card
   can generate the load for you: set a **Load throttle** between 1 % and 35 %
   and press **Spin motors** (after the acknowledgements). Anything that pulls a
   steady, measurable current works just as well.
#. **Enter what the meter says.** With the load steady, type the clamp meter's
   amps into **Calibrate from measured current**. The card scales
   :param:`BATT_AMP_PERVLT` by measured ÷ reported and writes it. The reported
   half of that ratio is the **median of readings sampled across the settled
   part of the spin**, not one instantaneous sample — current telemetry is
   noisy, and any noise in that number ends up permanently in the gain. The
   preview line says what the result does: what the vehicle would read at the
   load it just measured.

A **manual override** block below lets you type :param:`BATT_AMP_OFFSET` and
:param:`BATT_AMP_PERVLT` directly, for transferring known-good values from an
identical build or from a power module's datasheet.

.. important::

   **A gain needs a real load.** With props off, a motor spin may pull barely
   more than the aircraft draws standing still — and when the loaded and idle
   readings are nearly the same, the ratio between meter and vehicle is mostly
   describing the offset, not the gain. The card says so when it sees that, and
   the fix is to zero the offset first and then load it harder: more throttle,
   or a longer spin.

.. note::

   Calibrate at a current you actually fly at. A gain fitted at 2 A can be
   several amps out at hover current, and it is hover current the capacity
   estimate and the battery failsafe care about. Re-check after changing the
   power module, the ESC, or the battery lead.

Thermal calibration (TCAL)
--------------------------

**Thermal calibration** learns per-IMU gyro and accelerometer offsets *across
temperature* so the estimator stays stable from a cold boot to warm — it removes
the drift you'd otherwise see as the board heats up after power-on. It is an
**Expert-only** card at the bottom of the Calibration tab (enable Expert product
mode to see it), and it appears only on firmware that exposes the
``INS_TCALn_*`` parameters.

ArduPilot learns the fit **online**: you enable "learn", boot the board cold, and
let it warm through its temperature range — the firmware computes and saves the
coefficients at the top temperature on its own.

.. warning::

   Do this on the bench with **props removed**. The board must sit still and
   simply warm up; you are not flying during the learn.

Steps:

#. **Start cold.** Power the board off and let it cool to ambient. A genuinely
   cold board matters — the wider the temperature swing between cold boot and
   warm, the better the fit.
#. In **Calibration → Thermal calibration (TCAL)**, click **Prepare thermal
   calibration**. This stages ``INS_TCALn_ENABLE = 2`` (learn) for each IMU;
   **Apply** it in the draft bar.
#. **Reboot the board cold**, props off, and leave it powered and still. It
   self-heats through the range.
#. At the top temperature the fit is computed and saved automatically, and each
   IMU's enable flips back to ``1`` (enabled). **Reboot once more** to use it.

The card shows each IMU's current state (disabled / enabled / learning) and its
``TMIN → TMAX`` range. When the flight controller streams IMU temperature (from
``SCALED_IMU``), the card also shows the live temperature and warm-up progress
toward ``TMAX``; the firmware completes and saves the fit on its own once it
reaches the target, so you don't need to watch it.

Baro thrust calibration (VALT)
------------------------------

A multirotor's prop wash lowers the static pressure over the barometer as
throttle rises, so the baro reads a *higher* altitude the harder the motors
work. ArduPilot compensates for this linearly with ``BARO1_THST_SCALE`` (in
Pascals, subtracted per unit of normalized throttle). **Baro thrust calibration
(VALT)** fits that scale from a flight log.

It is an **Expert-only** card that appears only when a **downward rangefinder is
configured** on the connected vehicle (``RNGFND1_TYPE`` set), because the
calibration needs a rangefinder as the ground-truth height. It is **log-based**:
the app connects on the bench, not in flight, so you fly the hover first and then
upload that log.

Steps:

#. Fit a **downward-facing rangefinder** and confirm it logs (an ``RFND`` message
   with orientation *Down*).
#. Fly a **steady hover** at a fixed height in a stable mode, holding the throttle
   as constant as you can for several seconds. Repeat at **2–3 different heights**
   so the fit has more than one point.
#. Download that flight's ``.bin`` log.
#. In **Calibration → Baro thrust calibration (VALT)**, upload the log. The app
   pairs the barometer altitude (``CTUN.BAlt``) with the rangefinder ground truth
   (``RFND.Dist``) over the steady windows and fits

   .. math::

      \mathtt{BARO1\_THST\_SCALE} = -\frac{(\mathrm{baro\_error_m} \times 12)}{\mathrm{throttle}}

   (across several points, a least-squares fit through the origin of the pressure
   error against throttle; ~12 Pa per metre near sea level).
#. Review the fitted points, then **Stage** and **Apply** ``BARO1_THST_SCALE`` in
   the draft bar.
#. Re-fly and confirm the baro altitude holds steadier through throttle changes.

The card is hidden on firmware that doesn't expose ``BARO1_THST_SCALE`` (it is a
compile-time option).

See also the ArduPilot wiki: `Accelerometer Calibration
<https://ardupilot.org/copter/docs/common-accelerometer-calibration.html>`_,
`Compass Calibration
<https://ardupilot.org/copter/docs/common-compass-calibration-in-mission-planner.html>`_,
and `IMU Temperature Calibration
<https://ardupilot.org/copter/docs/common-imu-temperature-calibration.html>`_.
