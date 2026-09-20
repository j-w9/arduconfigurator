Sensors and Calibration
=======================

The **Sensors** (Calibration) tab calibrates the inertial sensors and compass so
the autopilot knows which way is up and where it is pointing. It runs each
calibration as a *guided action*: you press one button and the app walks the
flight controller through the procedure live, sending the MAVLink commands and
watching the vehicle's replies.

The tab is grouped into three **sub-tabs**, because these are three different
jobs:

- **Sensors** — bench work on the airframe's own sensors: **Accelerometer**,
  **Level**, **Compass**, **thermal calibration (TCAL)** — IMU and barometer —
  and airspeed on Plane.
- **Power** — **Battery voltage**, **Battery current**, and **ESC** throttle
  range.
- **Flight** — the ones that need an actual flight and a return trip:
  **Autotune flight**, **Hover learning**, and **Baro thrust (VALT)**.

The Flight cards all work the same way: you set something up, fly, land, plug
back in, and the card tells you what the vehicle came back with. None of them
can be driven from the bench, because the firmware does the learning in the air
and saves it on disarm.

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

Poses confirm themselves
~~~~~~~~~~~~~~~~~~~~~~~~

After the level pose you do not need to keep clicking. Once the pose graphic
reads **aligned** — the frame is within about 17° of the posture being asked
for — hold it still and accept the step when it reads aligned.
Only a frame that moves out of the pose restarts the timer, so hand-holding it
is fine — you do not need to put it down.

Level is deliberately excluded: a vehicle sitting on the bench is *already*
level when the calibration starts, so auto-confirm would fire before you had
placed anything. The manual **Confirm … Position** button stays available for
every pose — this removes the need to click, never the ability to.

.. note::

   Auto-confirm needs the pose to actually read as aligned, and alignment is
   measured from the vehicle's attitude — which ArduPilot computes *through*
   ``AHRS_ORIENTATION``. If that parameter does not match how the board is
   mounted, no pose will ever read as aligned and every step needs the manual
   button. When that happens, press confirm **while the vehicle is still in
   that position**, before you move on to the next one; confirming after you
   have already moved records the wrong attitude for that step.

Board orientation check
~~~~~~~~~~~~~~~~~~~~~~~

The six poses are also enough to work out how the flight controller is
physically mounted, so the app checks it as the calibration runs. There is
nothing extra to press.

If the mounting disagrees with ``AHRS_ORIENTATION``, the accelerometer card
says so when the calibration finishes and offers to stage the correct value.
Nothing is written: the value is staged as a draft you review and apply like
any other parameter change. It takes effect on the **next boot**, the vehicle
needs re-levelling afterwards, and it rotates the **compass** as well as the
IMU — so apply it only if the measurement matches how the board really sits.

When the setting already matches, the check says nothing at all. Silence is the
pass.

.. note::

   Gravity alone cannot determine yaw. A level reading fixes which way is down
   and says nothing about which way is forward, so the check needs at least two
   poses that are not along the same axis — *nose down* is the one that supplies
   the forward reference. If too few poses were recorded where the step asked
   for them, the app says it could not check rather than guessing.

   A board mounted at an angle that is not one of ArduPilot's fixed rotations
   needs ``CUST_ROT1``/``CUST_ROT2`` instead; the check reports that case rather
   than proposing the nearest standard value.

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

The card walks it as three numbered steps, in the order the procedure has to
happen in.

#. **Zero the offset.** With the pack connected and nothing drawing current,
   enter what your meter reads (0 A with the pack off) and press **Set offset**.
   It writes the :param:`BATT_AMP_OFFSET` that makes the present reading match.
#. **Draw a known load.** Clamp an ammeter on the pack lead. On Copter the card
   can generate the load for you: set a **Load throttle** between 1 % and 35 %
   and press **Spin motors** (after the acknowledgements). Anything that pulls a
   steady, measurable current works just as well. While the motors run the card
   shows what the vehicle reports and **how many seconds are left** — this is
   the one time-critical part, and you are holding a meter in the other hand.
   When the spin ends it says what it captured, from how many readings, and
   against what the aircraft draws at idle.
#. **Enter what the meter says.** The field is focused for you the moment the
   capture lands, so the number you just read can go straight in — the value
   stays usable after the motors stop. Type the clamp meter's amps into
   **Calibrate from measured current**. The card scales
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
the drift you'd otherwise see as the board heats up after power-on. It lives on
**Calibration → Sensors**, is **not** gated behind Expert mode, and appears only
on firmware that exposes the ``INS_TCALn_*`` parameters.

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
#. In **Calibration → Sensors → Thermal calibration (TCAL)**, set the
   **Target** temperature. This is the one input that matters: the firmware ends
   the learn when the IMU reaches it, and the firmware default of **70 °C** is
   out of reach for most airframes — a board left on the default learns forever
   and saves nothing. Pick a temperature this board actually reaches on the
   bench; the live IMU temperature on the card tells you what that is.

   **Start** is offered too, but the firmware overwrites it with wherever the
   board actually began when it saves, so treat it as a floor for validity
   rather than a promise about the run. The two must be at least **10 °C** apart
   or the fit is never accepted, and the card will not stage a narrower range.
#. Click **Prepare thermal calibration**. This stages the temperatures and
   ``INS_TCALn_ENABLE = 2`` (learn) for each IMU; **Apply** it in the draft bar.
#. **Reboot the board cold**, props off, and leave it powered and still. It
   self-heats through the range.
#. At the top temperature the fit is computed and saved automatically, and each
   IMU's enable flips back to ``1`` (enabled). **Reboot once more** to use it.

The card shows each IMU's current state (disabled / enabled / learning) and its
``TMIN → TMAX`` range, and warns if the target you have chosen is one the board
is unlikely to reach. When the flight controller streams IMU temperature (from
``SCALED_IMU``), the card also shows the live temperature and warm-up progress
toward ``TMAX``; the firmware completes and saves the fit on its own once it
reaches the target, so you don't need to watch it.

Barometer temperature calibration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The barometer has a **separate** temperature calibration, with its own
parameters and its own procedure — ``TCAL_*`` (ArduPilot's ``AP_TempCalibration``,
a Copter feature), not the per-IMU ``INS_TCALn_*`` above. It learns how the
barometer's pressure reading drifts as the board heats and corrects for it,
which is the altitude equivalent of what the IMU calibration does for attitude.
It shares the TCAL card because it is the same bench session: a cold board, left
still, warming up.

#. Start cold, props off, on the bench. The vehicle must stay **disarmed and
   completely still** — the firmware restarts the learn the moment the IMUs
   report movement.
#. Click **Prepare baro calibration** and **Apply**. That stages
   ``TCAL_ENABLED = 2`` (learn *and* use) — one parameter.
#. Leave it powered and untouched while it self-heats. Nothing is collected
   below **25 °C**, and it needs at least **7 °C** of rise before it fits.
#. The fit saves itself into ``TCAL_BARO_EXP``, with the range it covered in
   ``TCAL_TEMP_MIN`` / ``TCAL_TEMP_MAX``. All three are read-only — the learn
   writes them.
#. Leave it learning to keep refining, or press **Stop learning, keep values**
   to pin what it has (``TCAL_ENABLED = 1``, use the learned values).

The correction applies to the **first barometer** only.

Hover learning (two flights)
----------------------------

On **Calibration → Flight**, and only on firmware that carries the fork's
``ACC_ZBIAS_LEARN``.

Two things are learned in the air and saved when you disarm, so each costs a
flight:

#. **Hover throttle** (``MOT_THST_HOVER``), learned whenever
   ``MOT_HOVER_LEARN`` is 2 — which is ArduCopter's default, so usually there is
   nothing to stage. The card checks rather than assumes: if hover learning has
   been turned *off* on this vehicle it says so, because a flight then records
   nothing.
#. **Accelerometer Z-bias** (``ACC_ZBIAS_LEARN``), which compensates the DC
   offset motor vibration puts into AccZ. **EKF3 only** — the correction is
   applied inside EKF3, and the card warns on any other estimator rather than
   letting you waste a flight.

Both flights are the same flying: climb to about **5 m** and hold a steady hover
with as little stick input as you can for a minute or so, then land and disarm.

Plug back in afterwards and the card asks whether that was a good flight.
Answering **no** to flight 1 changes nothing — the vehicle re-learns the hover
throttle every flight, so simply flying again overwrites it. Answering no to
flight 2 clears the learned bias first, so the retry starts from zero instead of
refining a bad measurement.

Progress is read from the **values the flights left behind**, not from the enable
parameters, so it survives the unplug and is honest about a vehicle that arrives
with somebody else's calibration.

**Zeroize Hover Cal** puts it back to the start: hover throttle to its 0.35
default, every learned Z-bias to zero, and the enables cleared. Use it on a
vehicle that arrives already calibrated and reads as finished.

Autotune flight
---------------

Also on **Calibration → Flight**, and **not** gated behind Expert mode:
autotune is stock ArduCopter and is how an ordinary operator gets a tuned
aircraft. Autotune runs in the air and saves on disarm, so the app cannot watch
it — instead it remembers the gains before the flight and compares them
afterwards.

#. Pick the **axes** (``AUTOTUNE_AXES`` is a bitmask: roll, pitch, yaw, yaw-D).
   One axis at a time converges faster while you are searching; two is usual once
   you are close.
#. Press **Stage autotune**, apply, and fly autotune as normal.
#. Come back, plug in, and the card reports **per axis** what actually got
   tuned.

Per-axis matters: autotune genuinely finishes roll and gives up on yaw, and
"it didn't work" would be wrong about most of that flight. An axis counts as
tuned when any of its gains moved — autotune does not rewrite every term.

**Zeroize Tune** returns the selected axes to ArduCopter's stock gains — back to
*default*, not to zero, since a literal zero P gain is unflyable. It is
Copter-only, stages only what actually differs, and tells you how many gains it
would move. Take a snapshot first if you might want the tune back: nothing else
on this card reverts anything, because autotune already saved those gains on the
vehicle.

Baro thrust calibration (VALT)
------------------------------

A multirotor's prop wash lowers the static pressure over the barometer as
throttle rises, so the baro reads a *higher* altitude the harder the motors
work. ArduPilot compensates for this linearly with ``BARO1_THST_SCALE`` (in
Pascals, subtracted per unit of normalized throttle). **Baro thrust calibration
(VALT)** fits that scale from a flight log.

It is an **Expert-only**, log-based card on **Calibration → Flight**: the app
connects on the bench, not in flight, so the flying happens first and the log is
read afterwards.

The card appears when the **firmware carries** ``BARO1_THST_SCALE``. Baro thrust
compensation is a compile-time feature (``AP_BARO_THST_COMP_ENABLED``, off by
default), so a stock build simply does not have the parameter and cannot apply a
scale. Signing in to a log server is *not* required — when you are signed in the
card names the server it would pull logs from, and nothing more.

You can hand it a log two ways: choose a ``.bin`` from disk, or press **Pick from
vehicle** to list the logs the aircraft is still holding and read one straight
off it, with no download-then-upload round trip.

Two methods are offered, and the difference is what each needs to be true.

Bench ramp (preferred)
~~~~~~~~~~~~~~~~~~~~~~

No height is measured at all. **Restrain the airframe** so the props cannot lift
it — clamped down, or held nose-down so the wash goes sideways — then:

#. Arm and sit at idle for a few seconds. That quiet pressure is the baseline.
#. Step the throttle up through the range you actually fly, holding each step a
   second or two.
#. Disarm, download the ``.bin``, and upload it.

With the airframe fixed, every Pascal the barometer moves after throttle-up is
the thrust effect and nothing else, so the scale is simply the slope of
``BARO.Press − P0`` against the filtered ``MOTB.ThrOut``. The raw pressure is
used (``BARO.Press``, not ``CPress``), so the fitted number is the **total**
scale to set whatever the log already had, and ``MOTB.ThrOut`` is the exact
input the firmware filters — ``CTUN.ThO`` is the controller's request and differs
under mixer limiting.

The card reports a per-throttle bucket column, because the response is usually
mildly convex and one linear parameter cannot follow that. When the log carries
``MOT_THST_HOVER``, the recommendation is the slope **in the hover band** rather
than the global least-squares line: the point is to zero the error where the
aircraft flies. A cutoff scan also reports which ``BARO_THST_FILT`` the pressure
actually follows.

.. warning::

   **The log cannot prove the airframe was restrained.** A real hover reads
   identically to a clamped vehicle from the accelerometer (``|a|`` = g in both).
   The analysis flags a run whose shape looks like a hover, but only you know how
   it was flown — and fitting a hover this way produces a confidently wrong
   number.

Hover vs height
~~~~~~~~~~~~~~~

When a bench ramp is not practical, fit against a ground-truth height instead.

A downward rangefinder makes this easy but is **not required**: if the log has
one the app fits against it automatically, and if it does not, you enter the
height you hovered at and it fits against that.

#. *Optional:* fit a **downward-facing rangefinder** and confirm it logs (an
   ``RFND`` message with orientation *Down*). Without one, measure the hover
   height yourself and enter it on the card afterwards.
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
   the draft bar. Either method stages the same parameter through the same
   reviewed write path.
#. Re-fly and confirm the baro altitude holds steadier through throttle changes.

The card is hidden on firmware that doesn't expose ``BARO1_THST_SCALE`` (it is a
compile-time option).

See also the ArduPilot wiki: `Accelerometer Calibration
<https://ardupilot.org/copter/docs/common-accelerometer-calibration.html>`_,
`Compass Calibration
<https://ardupilot.org/copter/docs/common-compass-calibration-in-mission-planner.html>`_,
and `IMU Temperature Calibration
<https://ardupilot.org/copter/docs/common-imu-temperature-calibration.html>`_.
