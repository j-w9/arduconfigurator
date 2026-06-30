Peripherals & Gimbal
====================

The **Peripherals** surfaces configure add-on hardware that hangs off the flight
controller — a rangefinder/LiDAR for height and obstacle sensing, and a camera
mount/gimbal — in collapsible sections. Each section only renders the parameters
the connected firmware actually reports, so you see the controls that apply to
your build and nothing else.

.. contents:: On this page
   :local:
   :depth: 1

Rangefinder / LiDAR
-------------------

Configure a downward- or forward-facing rangefinder (the ``RNGFND1_*`` family;
``RNGFND2_*`` for a second sensor). The driver lives in ``RNGFND1_TYPE`` — pick
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

For the full sensor matrix and per-model wiring, see the ArduPilot
`Rangefinders landing page
<https://ardupilot.org/copter/docs/common-rangefinder-landingpage.html>`__.

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
