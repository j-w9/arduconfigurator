Peripherals & Gimbal
====================

The **Peripherals** surfaces configure add-on hardware that hangs off the flight
controller — a rangefinder/LiDAR for height and obstacle sensing, an optical
flow sensor, and a camera mount/gimbal — in collapsible sections. Each section
only renders the parameters the connected firmware actually reports, so you see
the controls that apply to your build and nothing else.

Rangefinder / LiDAR
-------------------

Configure a downward- or forward-facing rangefinder (the ``RNGFND1_*`` family).
The driver lives in ``RNGFND1_TYPE`` — pick
the backend that matches your hardware (for example *LightWareI2C*, *Benewake*,
*MAVLink*, *DroneCAN*, or *Analog*). Rangefinders feed precision landing, terrain
following, and surface tracking.

Key parameters:

- ``RNGFND1_TYPE`` — sensor driver. **Reboot after changing it.**
- ``RNGFND1_ORIENT`` — direction the sensor faces (*Down* for altitude/terrain,
  *Forward* for obstacle work).
- ``RNGFND1_MIN`` / ``RNGFND1_MAX`` — the reliable distance band (m); readings
  outside it are treated as out of range.
- ``RNGFND1_GNDCLR`` — distance the sensor reads when the vehicle is on the
  ground (its mounting height).
- ``RNGFND1_ADDR`` — bus address for I2C sensors.
- ``RNGFND1_POS_X/Y/Z`` — sensor offset from the centre of gravity.

Analog and PWM sensors reveal extra wiring controls only once the matching type
is selected — pin (``RNGFND1_PIN``), transfer function, scaling, offset, and an
optional power-save stop pin.

.. note::

   Serial sensors also need their port assigned to the rangefinder protocol on
   the :doc:`ports-serial` tab (``SERIALx_PROTOCOL`` = *Rangefinder*); I2C
   sensors use ``RNGFND1_ADDR`` instead. ArduPilot 4.7 moved the distance limits
   to metres (``RNGFND1_MIN`` / ``_MAX`` / ``_GNDCLR``); pre-4.7 firmware uses
   the centimetre forms (``RNGFND1_MIN_CM`` / ``_MAX_CM`` / ``_GNDCLEAR``). The
   section shows whichever set the connected firmware streams, never both.

.. note::

   Only the **first** rangefinder instance has a section here. If you fit a
   second sensor, its ``RNGFND2_*`` parameters are edited from the
   :doc:`../parameters` tab.

For the full sensor matrix and per-model wiring, see the ArduPilot
`Rangefinders landing page
<https://ardupilot.org/copter/docs/common-rangefinder-landingpage.html>`__.

Optical flow
------------

An optical flow sensor is a downward-facing camera that measures how fast the
ground is moving beneath the vehicle. Fused into the EKF it gives position hold
without GPS — the reason to fit one indoors or under cover.

The **Optical Flow** section configures the sensor. Getting flow working is a
three-part job, and skipping any one of them leaves a sensor that reads fine and
does nothing:

**1. Select the driver.** :param:`FLOW_TYPE` picks the backend: *PX4Flow*,
*Pixart*, *Bebop*, *CXOF*, *MAVLink*, **6 — DroneCAN** (a HereFlow or any other
DroneCAN flow node), *MSP*, or *UPFLOW*. ArduPilot 4.7 adds *10 — SITL* for
simulation. It is **reboot-required**: the driver does not load, and none of the
dependent fields appear, until the flight controller restarts.

.. tip::

   Choosing ``FLOW_TYPE = 6`` (DroneCAN) with the CAN bus switched off is the
   classic silent failure — the node is on the wire, powered, and completely
   invisible. The section detects this and offers a one-click **Enable CAN bus &
   reboot** prompt that writes ``CAN_P1_DRIVER = 1`` and ``CAN_D1_PROTOCOL = 1``.
   See :doc:`../can-dronecan`.

**2. Give the EKF a height reference.** Flow is an *angular* rate — radians per
second of apparent ground motion. Turning that into a ground speed requires
knowing how far away the ground is, so the estimator carries a terrain-height
state and observes it, best of all, with a **downward-facing rangefinder**. Fit
one and set its orientation to *Down* (``RNGFND1_ORIENT = 25``) using the
section above. Height also has to be reasonable: before takeoff is detected, and
while the estimated height above ground is under **0.5 m**, the EKF zeroes the
flow measurement outright — the camera cannot focus that close — so flow
contributes nothing over the first half-metre of a takeoff.

**3. Tell the EKF to use it.** Nothing changes until the estimator's source set
names optical flow: :param:`EK3_SRC1_VELXY` = **5 (OpticalFlow)**. Until then the
sensor streams, the Status & Info card reads healthy, and navigation still runs
entirely on GPS. Those ``EK3_SRC*`` parameters are deliberately **not** editable
in this section — changing which sensors the estimator trusts is not a
peripheral setting — so make that change from the :doc:`../parameters` tab, with
a snapshot saved first.

If a source is selected without the hardware behind it, ArduPilot refuses to arm
with ``EK3 sources require OpticalFlow`` or ``EK3 sources require RangeFinder``;
the rangefinder form of that check specifically wants a *down*-facing sensor.
See :doc:`arming` for where to read those messages.

Mounting and scaling
~~~~~~~~~~~~~~~~~~~~~

- :param:`FLOW_ORIENT_YAW` — how far the sensor is rotated relative to the
  airframe, in centidegrees. A sensor whose X axis points to the right of the
  vehicle's X axis takes a positive angle. Getting this wrong makes the vehicle
  drift at right angles to the correction it is trying to apply.
- :param:`FLOW_POS_X` / ``_Y`` / ``_Z`` — where the sensor's focal point sits in
  the body frame, in metres (X forward, Y right, Z down from the origin).
- :param:`FLOW_FXSCALER` / :param:`FLOW_FYSCALER` — per-axis scale corrections in
  parts per thousand, for variation in effective focal length between units.
  Each increment of 1 changes that axis's flow reading by 0.1 %; the range is
  ±800. Leave these at 0 unless you are correcting a measured error — the
  configurator has no auto-calibration for them.
- :param:`FLOW_ADDR` — bus address, for sensor types that offer a choice.
- :param:`FLOW_OPTIONS` — bit 0 marks the sensor as roll/pitch stabilised (on a
  gimbal). This parameter is **ArduPilot 4.7 and later**; the field does not
  appear on 4.6 firmware, which has no equivalent.

Checking it works
~~~~~~~~~~~~~~~~~

The **Status & Info** tab grows an *Optical Flow* card once :param:`FLOW_TYPE` is
non-zero. It shows the sensor's quality figure (0–255), the flow rate on each
axis in rad/s, the current height above ground, the driver in use, and how long
ago the last reading arrived — and it distinguishes *no track* (data arriving,
quality 0 — usually a featureless or badly-lit surface) from *data stopped*
(the sensor has gone quiet, which is a wiring or bus problem).

Slide the vehicle by hand over a textured floor at a realistic height and watch
the flow rates move in the direction you moved it. A quality that collapses over
plain surfaces is the sensor telling you the truth about the floor, not a fault.

For sensor-by-sensor wiring and the flight procedure, see the ArduPilot
`Optical Flow sensors
<https://ardupilot.org/copter/docs/common-optical-flow-sensors-landingpage.html>`__
page.

Gimbal / Mount
--------------

Configure a camera mount or gimbal (the ``MNT1_*`` family; ``MNT2_*`` for a
second mount). The driver lives in ``MNT1_TYPE`` — *Servo*, *SToRM32*,
*MAVLink (Gremsy/AVT)*, *Siyi*, *Viewpro*, and the other supported backends.

Key parameters:

- ``MNT1_TYPE`` — gimbal driver. **Reboot after changing it.**
- ``MNT1_DEFLT_MODE`` — the mode the mount enters at boot and when no other
  targeting command is active (*Retracted*, *Neutral*, *RC Targeting*, …).
- ``MNT1_RC_RATE`` — how fast RC input slews the gimbal in RC-targeting mode
  (0 selects angle control instead of rate control).
- ``MNT1_PITCH_MIN/MAX``, ``MNT1_ROLL_MIN/MAX``, ``MNT1_YAW_MIN/MAX`` — per-axis
  angle limits.
- ``MNT1_RETRACT_X/Y/Z`` and ``MNT1_NEUTRAL_X/Y/Z`` — the angles commanded in the
  retracted and neutral positions.
- ``MNT1_OPTIONS`` — per-mount option flags (a bitmask).

.. note::

   Serial gimbals also need a ``SERIALx_PROTOCOL`` assignment on the
   :doc:`ports-serial` tab. *Servo* gimbals are driven from autopilot PWM
   outputs instead, so they need the mount roles assigned on the
   :doc:`outputs-motors` tab (``SERVOx_FUNCTION``).

.. warning::

   Both ``RNGFND1_TYPE`` and ``MNT1_TYPE`` are reboot-required. The driver does
   not load until the flight controller restarts, so a sensor or gimbal will not
   appear — and its dependent controls will not stream — until you reboot and
   re-read parameters.

For supported gimbals and their per-vendor setup, see the ArduPilot
`Cameras and Gimbals
<https://ardupilot.org/copter/docs/common-cameras-and-gimbals.html>`__ page.
