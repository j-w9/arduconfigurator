Sensors and Calibration
=======================

The **Sensors** (Calibration) tab calibrates the inertial sensors and compass so
the autopilot knows which way is up and where it is pointing. Each calibration
runs as a *guided action*: you press one button and the app walks the flight
controller through the procedure live, sending the MAVLink commands and watching
the vehicle's replies.

The tab has three **sub-tabs**:

- **Sensors:** bench calibration of the airframe's own sensors:
  **Accelerometer**, **Level**, **Compass**, **thermal calibration (TCAL)** (IMU
  and barometer), and airspeed on Plane.
- **Power:** **Battery voltage**, **Battery current**, and **ESC** throttle
  range.
- **Flight:** calibrations that need a flight and a reconnect afterwards:
  **Hover throttle learning**, **Hover throttle from a log**, **Autotune
  flight**, **Accelerometer Z-bias**, and **Baro thrust (VALT)**, left to right
  in the order a new build flies them.

The Flight cards all work the same way. You set something up, fly, land and plug
back in, and the card tells you what the vehicle came back with. None of them
can run on the bench. The firmware does the learning in the air and saves it on
disarm.

.. warning::

   Calibrations send real commands to a real vehicle. Keep the props off, the
   vehicle disarmed, and the area clear. The app blocks each action while the
   vehicle is armed, while a motor test is running, or before the parameters
   have finished syncing.

Accelerometer (six-position)
----------------------------

Full accelerometer calibration captures the vehicle in six orientations so
ArduPilot can solve the per-axis offsets and scales. Press **Calibrate
Accelerometer**. The app prompts you through each pose in turn (*level*, *left
side*, *right side*, *nose down*, *nose up*, and *on its back*), and the button
relabels itself to the current pose (for example **Confirm Level Position**). A
pose graphic and the live roll/pitch readout help you set each orientation. Hold
the vehicle still, then press the confirm button to move to the next pose.

The app sends ``MAV_CMD_PREFLIGHT_CALIBRATION`` (param5 = 1) to start, and
acknowledges each pose as ArduPilot requests it. The first (level) pose sets your
flying-attitude reference, so make it as flat as you can. The other five only
need to be within about 20° of exact, as long as the vehicle is steady.

Poses confirm themselves
~~~~~~~~~~~~~~~~~~~~~~~~

After the level pose you do not need to keep clicking. When the pose graphic
reads **aligned** (the frame is within about 17° of the requested posture), hold
it still and accept the step when it reads aligned. Only moving out of the pose
restarts the timer, so you can hold the frame in your hand. You do not need to
put it down.

The level pose does not auto-confirm. A vehicle on the bench is already level
when the calibration starts, so auto-confirm would fire before you had placed
anything. The manual **Confirm … Position** button stays available for every
pose.

.. note::

   Auto-confirm needs the pose to read as aligned. Alignment is measured from the
   vehicle's attitude, which ArduPilot computes *through* ``AHRS_ORIENTATION``.
   If that parameter does not match how the board is mounted, no pose will read
   as aligned and every step needs the manual button. In that case, press
   confirm **while the vehicle is still in that position**, before you move to
   the next one. Confirming after you have moved records the wrong attitude for
   that step.

Board orientation check
~~~~~~~~~~~~~~~~~~~~~~~

The six poses also show how the flight controller is physically mounted, so the
app checks it as the calibration runs. There is nothing extra to press.

If the mounting disagrees with ``AHRS_ORIENTATION``, the accelerometer card says
so when the calibration finishes and offers to stage the correct value. Nothing
is written: the value is staged as a draft you review and apply like any other
parameter change. It takes effect on the **next boot**, and the vehicle needs
re-levelling afterwards. It rotates the **compass** as well as the IMU, so apply
it only if the measurement matches how the board sits.

When the setting already matches, the check shows nothing.

.. note::

   Gravity alone cannot determine yaw. A level reading fixes which way is down
   but not which way is forward, so the check needs at least two poses that are
   not along the same axis. *Nose down* supplies the forward reference. If too
   few poses were recorded where the step asked for them, the app says it could
   not check.

   A board mounted at an angle that is not one of ArduPilot's fixed rotations
   needs ``CUST_ROT1``/``CUST_ROT2`` instead. The check reports that case and
   does not propose the nearest standard value.

.. note::

   There is no MAVLink abort for accelerometer calibration. Pressing **Cancel**
   stops the app from tracking the procedure, but the flight controller keeps
   waiting for poses until it times out or you reboot it. Repeat the calibration
   whenever you change the board's mounting orientation.

Level (AHRS trim)
-----------------

**Calibrate Level** runs a quick board-level trim. Set the vehicle on the bench
in its normal flying attitude and press the button. The flight controller
samples gravity for about a second and stores the mounting tilt in
``AHRS_TRIM_X`` (roll) and ``AHRS_TRIM_Y`` (pitch). It sends
``MAV_CMD_PREFLIGHT_CALIBRATION`` with param5 = 2.

Use it to square up a frame that sits slightly off-level. It only corrects up to
about 10° of tilt, and only on roll and pitch, so it does not replace the full
six-position calibration above.

Compass
-------

**Calibrate Compass** runs ArduPilot's onboard magnetometer calibration. Press
the button, then slowly rotate the vehicle through all axes (nose, tail, each
side, top, and bottom pointed at the ground in turn) while the app shows a live
percentage. The app sends ``MAV_CMD_DO_START_MAG_CAL`` to all compasses with
auto-save enabled, watches the ``MAG_CAL_PROGRESS`` and ``MAG_CAL_REPORT``
messages, and writes the resulting ``COMPASS_OFS_X/Y/Z`` offsets on success.
**Cancel calibration** sends ``MAV_CMD_DO_CANCEL_MAG_CAL`` to stop the routine. A
watchdog cancels automatically if the vehicle stops reporting.

.. note::

   If the app reports a *bad orientation*, your board or compass orientation is
   wrong. Check ``AHRS_ORIENTATION`` (and any external-compass orientation)
   before retrying. Calibration needs at least one enabled compass. If none is
   detected, the action is blocked with a prompt to enable one or skip the step.

With and without GPS
~~~~~~~~~~~~~~~~~~~~~

Onboard compass calibration normally needs a GPS position to settle. The compass
card has a **Set location (no GPS)** control for vehicles with no GPS attached.
Pick a point on the map (or **Use my location**) and press **Start fake GPS**.
The app temporarily switches the GPS backend to *MAV* (``GPS1_TYPE`` = 14) and
streams synthetic ``GPS_INPUT`` so the calibration can complete. **Stop fake
GPS** restores your original ``GPS1_TYPE``. With a real GPS fix you can skip this
and calibrate directly.

.. warning::

   Calibrate well away from steel, magnets, speakers, and current-carrying
   wires. Magnetic interference is the most common cause of a failed or
   wandering compass calibration. The app does not offer a "large vehicle"
   (GPS-heading) magnetometer calibration. Use the rotate-through-all-axes
   procedure above.

Battery voltage and current
---------------------------

An analog power module does not measure volts and amps. It produces a voltage on
two flight-controller pins, and ArduPilot converts each one with a scale factor
you have to set. The default factors are a guess for a generic brick, so a fresh
build often reads a 6S pack as 21 V, or claims 55 A in a hover. The OSD, the
remaining-capacity estimate and the battery failsafe on the :doc:`failsafe` tab
all depend on these two numbers.

The **Battery voltage** and **Battery current** cards on this tab calibrate
them against a meter.

Voltage
~~~~~~~

ArduPilot computes pack voltage as the sensing pin's voltage multiplied by
:param:`BATT_VOLT_MULT`. Calibrating it takes one measurement:

#. Connect a charged pack and read its voltage at the balance lead or the XT
   connector with a multimeter.
#. In **Calibration → Battery voltage**, compare the meter against the *FC
   reads* pill and enter the meter's figure in **Measured voltage (V)**.
#. The card shows the **new multiplier** it will write (your current multiplier
   scaled by measured ÷ reported). **Apply voltage calibration** writes
   :param:`BATT_VOLT_MULT`.

Take the reading again afterwards to confirm the two agree. If they do not track
each other across a range (right at full charge, wrong at storage charge), the
problem is the sensing divider or a bad ground, not the multiplier.

Current
~~~~~~~

ArduPilot computes current as

   ``amps = (sensing_pin_voltage − BATT_AMP_OFFSET) × BATT_AMP_PERVLT``

so there are two numbers with different jobs. :param:`BATT_AMP_OFFSET` is the
sensor's output **at zero current** (a hall-effect sensor rarely sits at exactly
0 V). :param:`BATT_AMP_PERVLT` is the sensor's **gain**: how many amps a one-volt
change on that pin represents. An offset error adds a constant bias to every
reading. A gain error scales with throttle. Fix the offset first, or you will
fold it into the gain.

The card appears only for the analog current monitors: :param:`BATT_MONITOR`
values 4 (*Analog Voltage and Current*), 25 (*Synthetic Current and Analog
Voltage*), 28 (*AD7091R5*) and 31 (*Analog Current Only*). A DroneCAN, ESC, or
smart battery reports amps directly and needs none of this.

.. warning::

   Calibrating current means drawing real current. **Props off**, vehicle
   restrained, and stay clear of the frame. The card puts its motor-spin control
   behind props-removed and area-clear acknowledgements, and refuses while the
   vehicle is armed. Do not work around that.

The card has three numbered steps, in the order the procedure must happen:

#. **Zero the offset.** With the pack connected and nothing drawing current,
   enter what your meter reads (0 A with the pack off) and press **Set offset**.
   It writes the :param:`BATT_AMP_OFFSET` that makes the present reading match.
#. **Draw a known load.** Clamp an ammeter on the pack lead. On Copter the card
   can generate the load for you: set a **Load throttle** between 1 % and 35 %
   and press **Spin motors** (after the acknowledgements). Any other steady,
   measurable current draw works too. While the motors run, the card shows what
   the vehicle reports and **how many seconds are left**, since this is the one
   time-critical part and you are holding a meter in the other hand. When the
   spin ends, it says what it captured, from how many readings, and how that
   compares with what the aircraft draws at idle.
#. **Enter what the meter says.** The field gets focus as soon as the capture
   lands, so you can type the number you just read straight in. The value stays
   usable after the motors stop. Type the clamp meter's amps into **Calibrate
   from measured current**. The card scales :param:`BATT_AMP_PERVLT` by measured
   ÷ reported and writes it. The reported value is the **median of readings
   sampled across the settled part of the spin**, not one instantaneous sample.
   Current telemetry is noisy, and any noise in that number ends up in the gain
   permanently. The preview line shows what the vehicle would read at the load
   it just measured.

A **manual override** block below lets you type :param:`BATT_AMP_OFFSET` and
:param:`BATT_AMP_PERVLT` directly, to copy known-good values from an identical
build or from a power module's datasheet.

.. important::

   **A gain needs a real load.** With props off, a motor spin may pull barely
   more than the aircraft draws standing still. When the loaded and idle
   readings are nearly the same, the ratio between meter and vehicle mostly
   describes the offset, not the gain. The card warns you when it sees this. To
   fix it, zero the offset first, then load it harder: more throttle, or a
   longer spin.

.. note::

   Calibrate at a current you fly at. A gain fitted at 2 A can be several amps
   out at hover current, and hover current is what the capacity estimate and the
   battery failsafe use. Re-check after changing the
   power module, the ESC, or the battery lead.

Thermal calibration (TCAL)
--------------------------

**Thermal calibration** learns per-IMU gyro and accelerometer offsets *across
temperature*, so the estimator stays stable from a cold boot to warm. It removes
the drift you would otherwise see as the board heats up after power-on. It is on
**Calibration → Sensors**, is **not** gated behind Expert mode, and appears only
on firmware that exposes the ``INS_TCALn_*`` parameters.

ArduPilot learns the fit **online**, from the moment learning is switched on
(``AP_InertialSensor_tempcal.cpp``):

- it starts **straight away**, from whatever temperature the board is at, so
  start cold;
- it finishes at the **target** temperature once the board has risen at least
  **10 °C**. If the board never gets there, it finishes **10 minutes after the
  temperature stops rising** (again only after a 10 °C rise);
- it saves itself: each IMU's state flips to *on*, and ``TMIN`` / ``TMAX`` become
  the range it covered. A fit that fails turns thermal calibration off.

.. warning::

   Do this on the bench with **props removed**, disarmed. The board sits still
   and warms up. You do not fly during the learn.

The card has three steps, in order:

#. **Start cold.** Let the board cool to room temperature, then power it up and
   start straight away. The card shows the current IMU temperature.
#. **Pick a target** the board reaches on the bench, at least 10 °C above where
   it is. A target closer than that is refused, with the reason. A target the
   board will not reach (the firmware default is 70 °C) is allowed with a note,
   because the learn also ends when warming stalls.
#. **Start learning.** Tick **Learn the barometer in the same session** to start
   the baro learn with it.

Start writes straight to the flight controller, with verification, in this
order: each IMU's ``INS_TCALn_TMAX``, then each ``INS_TCALn_ENABLE = 2``, then
``TCAL_ENABLED = 2`` if the barometer is ticked. There is no draft to apply. The
order matters: ``INS_TCALn_ENABLE`` hides the rest of its group while it is off,
so a board with thermal calibration off does not report ``TMAX``. The learn
takes its target the moment the enable becomes 2. ``TMIN`` is not written; the
learn overwrites it.

While it learns, the card shows the board temperature against the target and the
vehicle's latest ``TCAL[n]`` message. You do not need to press anything. To stop
early:

- **Stop learning, keep values** (``ENABLE = 1``): use what it has saved. The
  learn saves a partial fit every 15 s once the board has risen 10 °C. Before
  that there is nothing new to keep.
- **Stop and turn off** (``ENABLE = 0``): no thermal correction.

A calibrated board also offers **Turn thermal cal off**, and **Learn again**
starts a fresh run from cold.

Barometer temperature calibration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The barometer has a **separate** temperature calibration, with its own
parameters and procedure: ``TCAL_*`` (ArduPilot's ``AP_TempCalibration``, a
Copter feature), not the per-IMU ``INS_TCALn_*`` above. It learns how the
barometer's pressure reading drifts as the board heats, and corrects for it. It
does for altitude what the IMU calibration does for attitude. It shares the TCAL
card because it uses the same bench session: a cold board, left still, warming
up.

#. Start cold, props off, on the bench. The vehicle must stay **disarmed and
   completely still**. The firmware restarts the learn as soon as the IMUs
   report movement.
#. Click **Start baro learning** (or tick the barometer box when starting the
   IMU learn). That writes one parameter: ``TCAL_ENABLED = 2`` (learn *and*
   use).
#. Leave it powered and untouched while it self-heats. Nothing is collected
   below **25 °C**, and it needs at least **7 °C** of rise before it fits.
#. The fit saves itself into ``TCAL_BARO_EXP``, with the range it covered in
   ``TCAL_TEMP_MIN`` / ``TCAL_TEMP_MAX``. All three are read-only; the learn
   writes them.
#. Leave it learning to keep refining, or press **Stop learning, keep values**
   to keep what it has (``TCAL_ENABLED = 1``, use the learned values). **Turn
   off** sets ``TCAL_ENABLED = 0``.

The correction applies to the **first barometer** only.

Hover calibration
-----------------

Three cards on **Calibration → Flight** cover this: **Hover throttle learning**,
**Hover throttle from a log**, and **Accelerometer Z-bias**. Only the Z-bias
card needs the fork's ``ACC_ZBIAS_LEARN``. Hover throttle is stock ArduCopter
and offered on any copter.

You fly two flights, in order. The second is meaningless until the first is
right. Where **tuning** fits between them depends on the build:

- **A copy-and-paste build** (parameters carried over from a frame that already
  flies well) already has its tune. Fly hover throttle, then Z-bias, back to
  back.
- **A new build** flies the hover throttle first, then **tunes** (filters, then
  the :ref:`autotune flight <autotune-flight>`), and learns the Z-bias **last**.
  The bias is the vibration the airframe puts into AccZ at the hover you will
  fly. An untuned copter hovers with oscillation and vibration the tune will
  remove, so a bias learned before the tune describes a hover you will not fly
  again.

Re-learn the Z-bias after anything that changes vibration: props, motors,
mounts, a frame change, or a new tune.

Flight 1: hover throttle
~~~~~~~~~~~~~~~~~~~~~~~~~

``MOT_THST_HOVER`` is the controller's **vertical feedforward**: the throttle it
expects to need to hold altitude. Nothing that holds altitude behaves properly
until it is right. Once it is, set the vertical accel gains from it: **Tuning →
Pilot → Alt Hold** checks them against ArduPilot's rule (see
:ref:`tuning-althold-controller`).

The firmware learns it in the air when ``MOT_HOVER_LEARN`` is 2 (its default),
but only while every gate is open. ``Copter::update_throttle_hover`` returns
early in any **manual-throttle mode** (Stabilize, Acro, SystemID, Turtle) and in
Drift, while a climb or descent is commanded, without a vertical-velocity
estimate, or past 5° of tilt. **A perfect hover flown in Stabilize learns
nothing**: ``MOT_THST_HOVER`` stays at exactly its 0.35 default, as if you had
never flown.

Fly it in a mode that **holds altitude**: AltHold, Loiter, PosHold, or VALT on
firmware that has it. Climb to about 5 m, **centre the throttle stick**, and let
it sit level with as little input as you can. Twenty seconds of steady hover is
enough; a minute is better. Land and disarm. The value is saved on disarm.

Accepting that flight also stages ``MOT_HOVER_LEARN = 0``, which freezes what you
signed off. Left at 2, the Z-bias flight would re-learn and overwrite it with a
number you did not approve. **Re-learn on the next hover** puts it back.

When the firmware will not learn it
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Hover throttle from a log** measures it from a flight you have already flown.
It is a once-per-airframe job. Do it when a new frame and powertrain first fly,
or when the firmware's own learner came back with nothing.

Upload that flight's ``.bin``. The card finds the steady-hover segments using
the firmware's own gates, averages ``CTUN.ThO`` (the same quantity the learner
filters), and stages ``MOT_THST_HOVER``. It also reports whether ``CTUN.ThH``
ever moved and which mode the hover was flown in.

.. note::

   ``MOT_THST_HOVER`` clamps to a minimum of **0.125**
   (``AP_MOTORS_THST_HOVER_MIN``). A light, overpowered build can hover below
   that. The parameter then records the floor, not a measurement, and the card
   says so.

Flight 2: accelerometer Z-bias
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``ACC_ZBIAS_LEARN`` compensates for the DC offset that motor vibration puts into
AccZ. **EKF3 only:** the correction is applied inside EKF3, so the card warns you
if another estimator is in use, before you waste a flight.

The firmware reads its two bits independently, so they are states, not a
sequence: **3** is the learning flight (learn *and* apply) and **2** is finished
(apply, learning off). Accepting the flight stages 2, which freezes the accepted
bias the same way flight 1 freezes the hover throttle.

Fly the same hover again (on a new build, only once the copter is tuned; see
above). Answering **no** clears the learned bias first, so the retry starts from
zero.

Progress is read from the **values the flights left behind**, not from the enable
parameters. It survives an unplug, and it shows when a vehicle arrives with
someone else's calibration.

**Clear Z-Bias Cal** starts the Z-bias over: it zeroes every learned bias, clears
the enable and re-arms hover learning. It **leaves ``MOT_THST_HOVER`` alone**.
Writing the 0.35 default back to a quad that hovers at 0.118 would tell the
controller to expect roughly three times the thrust it needs, and the next
AltHold takeoff would leap. Replace a measured hover throttle only from a log or
another flight.

.. _autotune-flight:

Autotune flight
---------------

Also on **Calibration → Flight**, and **not** gated behind Expert mode.
Autotune is stock ArduCopter and how most pilots get a tune. It runs in the air
and saves on disarm, so the app cannot watch it. The card records the gains
before the flight and compares them after.

#. Pick the **axes** (``AUTOTUNE_AXES`` is a bitmask: roll, pitch, yaw, yaw-D).
   One axis at a time converges faster while you are searching. Two is usual
   once you are close.
#. Press **Stage autotune**, apply, and fly autotune as normal.
#. Come back, plug in, and the card reports **per axis** what got tuned.

Results are per axis because autotune can finish roll and give up on yaw. An
axis counts as tuned when any of its gains moved, because autotune does not
rewrite every term.

**Zeroize Tune** returns the selected axes to ArduCopter's stock gains (back to
*default*, not to zero; a zero P gain is unflyable). It is Copter-only, stages
only what differs, and says how many gains it would move. Take a snapshot first
if you may want the tune back. Nothing else on this card reverts anything,
because autotune saved its gains on the vehicle.

Baro thrust calibration (VALT)
------------------------------

A multirotor's prop wash lowers the static pressure over the barometer as
throttle rises, so the baro reads a *higher* altitude the harder the motors
work. ArduPilot compensates for this linearly with ``BARO1_THST_SCALE`` (in
Pascals, subtracted per unit of normalized throttle). **Baro thrust calibration
(VALT)** fits that scale from a flight log.

It is a log-based card on **Calibration → Flight**. The app connects on the
bench, not in flight, so you fly first and the card reads the log afterwards.

The card appears when the **firmware carries** ``BARO1_THST_SCALE``. Baro thrust
compensation is a compile-time feature (``AP_BARO_THST_COMP_ENABLED``, off by
default), so a stock build does not have the parameter and cannot apply a
scale. You do not need to sign in to a log server. When you are signed in, the
card only names the server it would pull logs from.

You can give it a log two ways: choose a ``.bin`` from disk, or press **Pick from
vehicle** to list the logs the aircraft is still holding and read one directly
from it, without downloading and re-uploading.

There are two methods, and each needs a different condition to hold.

Bench ramp (preferred)
~~~~~~~~~~~~~~~~~~~~~~

No height is measured. **Restrain the airframe** so the props cannot lift it
(clamped down, or held nose-down so the wash goes sideways), then:

#. Arm and sit at idle for a few seconds. That quiet pressure is the baseline.
#. Step the throttle up through the range you fly, holding each step for a
   second or two.
#. Disarm, download the ``.bin``, and upload it.

With the airframe fixed, every Pascal the barometer moves after throttle-up is
the thrust effect, so the scale is the slope of ``BARO.Press − P0`` against the
filtered ``MOTB.ThrOut``. The fit uses raw pressure (``BARO.Press``, not
``CPress``), so the fitted number is the **total** scale to set, whatever the
log already had. ``MOTB.ThrOut`` is the exact input the firmware filters.
``CTUN.ThO`` is the controller's request and differs under mixer limiting.

The card reports a per-throttle bucket column, because the response is usually
mildly convex and one linear parameter cannot follow that. When the log carries
``MOT_THST_HOVER``, the recommendation is the slope **in the hover band**, not
the global least-squares line, so the error is zeroed where the aircraft flies.
A cutoff scan also reports which ``BARO_THST_FILT`` the pressure follows.

.. warning::

   **The log cannot prove the airframe was restrained.** To the accelerometer, a
   real hover reads the same as a clamped vehicle (``|a|`` = g in both). The
   analysis flags a run whose shape looks like a hover, but only you know how it
   was flown. Fitting a hover this way produces a confidently wrong number.

Hover vs height
~~~~~~~~~~~~~~~

When a bench ramp is not practical, fit against a ground-truth height instead.

A downward rangefinder makes this easier but is **not required**. If the log has
one, the app fits against it automatically. If it does not, you enter the height
you hovered at and it fits against that.

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
   the draft bar. Both methods stage the same parameter through the same
   reviewed write path.
#. Re-fly and confirm the baro altitude holds steadier through throttle changes.

The card is hidden on firmware that does not expose ``BARO1_THST_SCALE`` (it is a
compile-time option).

See also the ArduPilot wiki: `Accelerometer Calibration
<https://ardupilot.org/copter/docs/common-accelerometer-calibration.html>`_,
`Compass Calibration
<https://ardupilot.org/copter/docs/common-compass-calibration-in-mission-planner.html>`_,
and `IMU Temperature Calibration
<https://ardupilot.org/copter/docs/common-imu-temperature-calibration.html>`_.
