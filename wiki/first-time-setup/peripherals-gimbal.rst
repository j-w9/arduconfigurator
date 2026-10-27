Peripherals & Gimbal
====================

The **Peripherals** tab configures the hardware attached to the flight
controller: the GPS, the compass, a rangefinder/LiDAR for height and obstacle
sensing, an optical flow sensor, a camera mount/gimbal and its shutter trigger,
the notification LEDs and buzzer, and the relay outputs. It has one sub-tab per
peripheral (**GPS**, **Compass**, **Camera & Gimbal**, **Flow & Lidar**,
**LEDs & Buzzer**, **Relays**), so you work on one at a time. Each section shows
only the parameters the connected firmware reports.

.. note::

   GPS and compass are documented in detail on :doc:`../config` and
   :doc:`sensors-calibration`. The rest of this page covers the sections unique
   to this tab. The servo output map is on :doc:`servos-relays`.

The **GPS** sub-tab holds the **Primary** and **Secondary GPS** cards. They
report whether a configured driver is talking, not only selected. It also has a
**live map** to confirm the aircraft is where it says it is, and the
second-receiver and antenna-offset settings (``GPS_TYPE2``, ``GPS_GNSS_MODE2``,
``GPS1_POS_*`` / ``GPS2_POS_*``, ``GPS1_DELAY_MS``). The UART itself is set up on
:doc:`ports-serial`; the device on the other end of it is configured here.

.. note::

   The cards show "driver selected" and "receiver talking" as separate states.
   If a driver is set but no GPS reports at all, check the wiring: the module
   must be on a UART with TX/RX the right way round, the port protocol must be
   GPS, and the module must have power. A module that reports but has no fix
   needs a view of the sky.

Rangefinder / LiDAR
-------------------

Configure a downward- or forward-facing rangefinder (the ``RNGFND1_*`` family).
Set the driver in ``RNGFND1_TYPE``: pick the backend that matches your hardware
(for example *LightWareI2C*, *Benewake*, *MAVLink*, *DroneCAN*, or *Analog*).
Rangefinders feed precision landing, terrain following, and surface tracking.

Key parameters:

- ``RNGFND1_TYPE``: sensor driver. **Reboot after changing it.**
- ``RNGFND1_ORIENT``: the direction the sensor faces (*Down* for
  altitude/terrain, *Forward* for obstacle work).
- ``RNGFND1_MIN`` / ``RNGFND1_MAX``: the reliable distance band (m). Readings
  outside it count as out of range.
- ``RNGFND1_GNDCLR``: the distance the sensor reads when the vehicle is on the
  ground (its mounting height).
- ``RNGFND1_ADDR``: bus address for I2C sensors.
- ``RNGFND1_POS_X/Y/Z``: sensor offset from the centre of gravity.

Analog and PWM sensors show extra wiring controls once the matching type is
selected: pin (``RNGFND1_PIN``), transfer function, scaling, offset, and an
optional power-save stop pin.

.. note::

   Serial sensors also need their port set to the rangefinder protocol on the
   :doc:`ports-serial` tab (``SERIALx_PROTOCOL`` = *Rangefinder*). I2C sensors
   use ``RNGFND1_ADDR`` instead. ArduPilot 4.7 moved the distance limits to
   metres (``RNGFND1_MIN`` / ``_MAX`` / ``_GNDCLR``). Pre-4.7 firmware uses the
   centimetre forms (``RNGFND1_MIN_CM`` / ``_MAX_CM`` / ``_GNDCLEAR``). The
   section shows whichever set the connected firmware streams, never both.

.. note::

   Only the **first** rangefinder instance has a section here. If you fit a
   second sensor, edit its ``RNGFND2_*`` parameters on the
   :doc:`../parameters` tab.

For the full sensor matrix and per-model wiring, see the ArduPilot
`Rangefinders landing page
<https://ardupilot.org/copter/docs/common-rangefinder-landingpage.html>`__.

Optical flow
------------

An optical flow sensor is a downward-facing camera that measures how fast the
ground moves beneath the vehicle. When the EKF fuses it, you get position hold
without GPS, which is why you fit one indoors or under cover.

The **Optical Flow** section configures the sensor. Flow needs three things set
up. If any one is missing, the sensor reads fine and does nothing.

**1. Select the driver.** :param:`FLOW_TYPE` picks the backend: *PX4Flow*,
*Pixart*, *Bebop*, *CXOF*, *MAVLink*, **6 — DroneCAN** (a HereFlow or any other
DroneCAN flow node), *MSP*, or *UPFLOW*. ArduPilot 4.7 adds *10 — SITL* for
simulation. It is **reboot-required**: the driver does not load, and none of the
dependent fields appear, until the flight controller restarts.

.. tip::

   A common silent failure is ``FLOW_TYPE = 6`` (DroneCAN) with the CAN bus
   switched off. The node is on the wire and powered, but invisible. The
   section detects this and offers a one-click **Enable CAN bus & reboot**
   prompt that writes ``CAN_P1_DRIVER = 1`` and ``CAN_D1_PROTOCOL = 1``.
   See :doc:`../can-dronecan`.

**2. Give the EKF a height reference.** Flow is an *angular* rate: radians per
second of apparent ground motion. To turn that into a ground speed the
estimator needs to know how far away the ground is. It carries a terrain-height
state, and a **downward-facing rangefinder** is the best way to observe it. Fit
one and set its orientation to *Down* (``RNGFND1_ORIENT = 25``) in the section
above. The height also has to be reasonable. Before takeoff is detected, and
while the estimated height above ground is under **0.5 m**, the EKF zeroes the
flow measurement because the camera cannot focus that close. Flow contributes
nothing over the first half-metre of a takeoff.

**3. Tell the EKF to use it.** Nothing changes until the estimator's source set
names optical flow: :param:`EK3_SRC1_VELXY` = **5 (OpticalFlow)**. Until then the
sensor streams, the Status & Info card reads healthy, and navigation still runs
entirely on GPS. The ``EK3_SRC*`` parameters are **not** editable in this
section, because they decide which sensors the estimator trusts. Change them on
the :doc:`../parameters` tab, and save a snapshot first.

If a source is selected without the hardware behind it, ArduPilot refuses to arm
with ``EK3 sources require OpticalFlow`` or ``EK3 sources require RangeFinder``.
The rangefinder check wants a *down*-facing sensor. See :doc:`arming` for where
to read those messages.

Mounting and scaling
~~~~~~~~~~~~~~~~~~~~~

- :param:`FLOW_ORIENT_YAW`: how far the sensor is rotated relative to the
  airframe, in centidegrees. A sensor whose X axis points to the right of the
  vehicle's X axis takes a positive angle. If this is wrong, the vehicle drifts
  at right angles to the correction it is trying to apply.
- :param:`FLOW_POS_X` / ``_Y`` / ``_Z``: where the sensor's focal point sits in
  the body frame, in metres (X forward, Y right, Z down from the origin).
- :param:`FLOW_FXSCALER` / :param:`FLOW_FYSCALER`: per-axis scale corrections in
  parts per thousand, for differences in effective focal length between units.
  Each step of 1 changes that axis's flow reading by 0.1 %. The range is ±800.
  Leave these at 0 unless you are correcting a measured error. The app has no
  auto-calibration for them.
- :param:`FLOW_ADDR`: bus address, for sensor types that offer a choice.
- :param:`FLOW_OPTIONS`: bit 0 marks the sensor as roll/pitch stabilised (on a
  gimbal). This parameter is **ArduPilot 4.7 and later**. The field does not
  appear on 4.6 firmware, which has no equivalent.

Checking it works
~~~~~~~~~~~~~~~~~

The **Status & Info** tab shows an *Optical Flow* card once :param:`FLOW_TYPE` is
non-zero. It shows the sensor's quality figure (0–255), the flow rate on each
axis in rad/s, the current height above ground, the driver in use, and how long
ago the last reading arrived. It tells two failures apart:

- *no track*: data is arriving with quality 0, usually over a featureless or
  badly lit surface;
- *data stopped*: the sensor has gone quiet, which is a wiring or bus problem.

Slide the vehicle by hand over a textured floor at a realistic height and check
that the flow rates move in the direction you moved it. If quality drops over
plain surfaces, that is the floor, not a fault.

For sensor-by-sensor wiring and the flight procedure, see the ArduPilot
`Optical Flow sensors
<https://ardupilot.org/copter/docs/common-optical-flow-sensors-landingpage.html>`__
page.

Gimbal / Mount
--------------

Configure a camera mount or gimbal (the ``MNT1_*`` family; ``MNT2_*`` for a
second mount). Set the driver in ``MNT1_TYPE``: *Servo*, *SToRM32*,
*MAVLink (Gremsy/AVT)*, *Siyi*, *Viewpro*, and the other supported backends.

Key parameters:

- ``MNT1_TYPE``: gimbal driver. **Reboot after changing it.**
- ``MNT1_DEFLT_MODE``: the mode the mount enters at boot and when no other
  targeting command is active (*Retracted*, *Neutral*, *RC Targeting*, …).
- ``MNT1_RC_RATE``: how fast RC input slews the gimbal in RC-targeting mode
  (0 selects angle control instead of rate control).
- ``MNT1_PITCH_MIN/MAX``, ``MNT1_ROLL_MIN/MAX``, ``MNT1_YAW_MIN/MAX``: per-axis
  angle limits.
- ``MNT1_RETRACT_X/Y/Z`` and ``MNT1_NEUTRAL_X/Y/Z``: the angles commanded in the
  retracted and neutral positions.
- ``MNT1_OPTIONS``: per-mount option flags (a bitmask).

.. note::

   Serial gimbals also need a ``SERIALx_PROTOCOL`` assignment on the
   :doc:`ports-serial` tab. *Servo* gimbals are driven from autopilot PWM
   outputs instead, so they need the mount roles assigned on the
   :doc:`outputs-motors` tab (``SERVOx_FUNCTION``).

.. warning::

   Both ``RNGFND1_TYPE`` and ``MNT1_TYPE`` are reboot-required. The driver does
   not load until the flight controller restarts. Until you reboot and re-read
   parameters, the sensor or gimbal will not appear and its dependent controls
   will not stream.

For supported gimbals and their per-vendor setup, see the ArduPilot
`Cameras and Gimbals
<https://ardupilot.org/copter/docs/common-cameras-and-gimbals.html>`__ page.
