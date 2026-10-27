Arming & Pre-arm Checks
=======================

A first build often gets stuck here: everything is wired, everything reads
right, and the vehicle still refuses to arm. ArduPilot's pre-arm checks are
blocking it, and they always say why. Read the reason and fix what it found.
Don't turn the check off to get past it.

The settings are on the **Config** tab under the **Arming** category. The
pre-arm *results* are on the **Status & Info** tab.

Reading why it will not arm
---------------------------

ArduPilot broadcasts each pre-arm failure as a MAVLink status message and
repeats it periodically while the condition persists. The app shows them in
three places:

- **Status & Info → Pre-arm:** a badge reading *Clear* or *N issues*, with the
  failure text listed underneath. Read this one.
- The **global status bar** carries an *N pre-arm issues* chip, so you notice
  from any tab.
- **Recent notices** carries the raw message stream, for the messages that are
  not pre-arm failures.

Work down the list from the top. Most entries name the subsystem and the
parameter to look at, and most lead to a tab in this section: a compass failure
to :doc:`sensors-calibration`, a battery failure to :doc:`power-battery`, an RC
failure to :doc:`receiver` or :doc:`ports-serial`.

.. warning::

   :param:`ARMING_OPTIONS` bit 0 is *Disable prearm display*. Setting it stops
   the vehicle sending the messages this page is about. Leave it clear.

Which checks run
----------------

**This parameter changed name and meaning in ArduPilot 4.7.** Both firmwares are
in the field, and the two are inverses of each other. Read the label the app
shows you; don't assume:

.. list-table::
   :header-rows: 1
   :widths: 18 22 60

   * - Firmware
     - Parameter
     - Meaning
   * - 4.6 and earlier
     - ``ARMING_CHECK``
     - Bitmask of checks to **perform**. Bit 0 is *All*, and the default is 1:
       every check runs. Clearing bits removes checks.
   * - 4.7 and later
     - :param:`ARMING_SKIPCHK`
     - Bitmask of checks to **skip**. The default is 0: every check runs.
       Setting bits removes checks. ``-1`` skips every non-mandatory check,
       including ones added by future releases.

The configurator binds whichever one your connected firmware reports and
labels it to match (*Check bitmask* or *Checks to skip*). It edits it as a grid
of per-bit checkboxes, with a raw numeric box beside it for pasting a value you
already have.

.. warning::

   Because the sense is inverted, a bitmask value copied from a 4.6 aircraft is
   dangerous on 4.7. ``ARMING_CHECK = 1`` meant *run everything*, while
   :param:`ARMING_SKIPCHK` ``= 1`` means *skip the barometer check*. Do not
   move the number across by hand. For this reason, restoring a 4.6 backup onto
   4.7 firmware is flagged as a version mismatch in the :doc:`../parameters`
   tab's import diff.

Upgrading an aircraft from 4.6 to 4.7 converts the value for you on the first
boot:

- If the old ``ARMING_CHECK`` had the *All* bit set, the new parameter becomes 0
  (run everything).
- If it had specific bits selected, they are inverted into the equivalent skip
  mask.
- If it was 0 (which meant *no checks* on 4.6), the new parameter becomes
  ``-1``, which keeps the old behaviour of running nothing.

The result is saved, so the conversion runs once.

The check bits are the same on both. Only the polarity differs:

1 Barometer · 2 Compass · 3 GPS lock · 4 INS · 5 Parameters · 6 RC Channels ·
7 Board voltage · 8 Battery Level · 10 Logging Available · 11 Hardware safety
switch · 12 GPS Configuration · 13 System · 14 Mission · 15 Rangefinder ·
16 Camera · 17 AuxAuth · 18 VisualOdometry · 19 FFT

.. note::

   Some checks cannot be turned off by either parameter. **Mandatory checks**
   (RC input calibration, and the serial-protocol check described below) run
   even on a forced arm.

Checks you cannot skip
----------------------

The mandatory check people hit most often is:

   ``Multiple SERIAL ports configured for RC input``

More than one ``SERIALn_PROTOCOL`` is set to RC Input (23). ArduPilot binds the
**lowest-numbered** such port to the receiver and warns about the others at
boot. The firmware treats the extra ports as a configuration error and will not
arm. Fix it on the :doc:`ports-serial` tab, which explains how to find the stray
port.

Disabling checks
----------------

Some setups have good reasons to skip a check: a bench session with no GPS, a
compass-less build, an indoor optical-flow aircraft. A check that keeps failing
is not a reason to skip it.

.. warning::

   A pre-arm check that fails on the bench describes a fault that will still be
   there in the air. Skipping the check does not fix the fault. It removes the
   last warning you would have got about it. Fix it, then re-check the box.

If you do skip a check, skip that specific bit, not *All* / ``-1``. Put it back
when the temporary reason is gone.

Arming with the sticks
----------------------

:param:`ARMING_RUDDER` controls whether the rudder (yaw) stick can arm and
disarm the vehicle. On ArduCopter it defaults to **2 — ArmOrDisarm**: hold yaw
right to arm, yaw left to disarm. ``1`` allows arming only. ``0`` disables
stick arming, so only a ground-station command or an auxiliary switch can arm.

Rudder arming only works with the throttle at zero, within the throttle
channel's deadzone (``RCn_DZ``). Some flight modes refuse it regardless.

.. note::

   ``ARMING_REQUIRE`` appears in the Arming card only on **ArduPlane and
   ArduRover**. The parameter does not exist on ArduCopter, so the field does
   not show on a Copter build.

.. warning::

   Once arming succeeds, the props are live. Do bench work with the propellers
   removed. See the motor-test guards described on :doc:`outputs-motors`.

For the full check-by-check reference and what each failure message means, see
the ArduPilot wiki: `Arming / Disarming
<https://ardupilot.org/copter/docs/arming_the_motors.html>`__ and
`Prearm Safety Checks
<https://ardupilot.org/copter/docs/common-prearm-safety-checks.html>`__.
