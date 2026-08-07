Arming & Pre-arm Checks
=======================

A first build usually gets stuck here: everything is wired, everything reads
right, and the vehicle still refuses to arm. That refusal is ArduPilot's pre-arm
check set doing its job, and it always tells you why — the trick is knowing where
to read the answer, and resisting the urge to silence the check instead of
fixing what it found.

The settings live on the **Config** tab under the **Arming** category. The
pre-arm *results* live on the **Status & Info** tab.

Reading why it will not arm
---------------------------

ArduPilot broadcasts each pre-arm failure as a MAVLink status message and
repeats it periodically while the condition persists. The configurator collects
those and surfaces them in three places:

- **Status & Info → Pre-arm** — a badge reading *Clear* or *N issues*, with the
  actual failure text listed underneath. This is the one to read.
- The **global status bar** carries an *N pre-arm issues* chip, so you notice
  from any tab.
- **Recent notices** carries the raw message stream, for the messages that are
  not pre-arm failures.

Work the list top down. Most entries name the subsystem and the parameter to
look at, and most trace back to a tab in this section — a compass failure to
:doc:`sensors-calibration`, a battery failure to :doc:`power-battery`, an RC
failure to :doc:`receiver` or :doc:`ports-serial`.

.. warning::

   :param:`ARMING_OPTIONS` bit 0 is *Disable prearm display*. Setting it stops
   the vehicle sending the very messages this page is about. Leave it clear.

Which checks run
----------------

**This parameter changed name and meaning in ArduPilot 4.7.** Both firmwares are
in the field, and the two are inverses of each other, so read the label the app
shows you rather than assuming:

.. list-table::
   :header-rows: 1
   :widths: 18 22 60

   * - Firmware
     - Parameter
     - Meaning
   * - 4.6 and earlier
     - ``ARMING_CHECK``
     - Bitmask of checks to **perform**. Bit 0 is *All*, and the default is 1 —
       every check runs. Clearing bits removes checks.
   * - 4.7 and later
     - :param:`ARMING_SKIPCHK`
     - Bitmask of checks to **skip**. The default is 0 — every check runs.
       Setting bits removes checks. ``-1`` skips every non-mandatory check,
       including ones added by future releases.

The configurator binds whichever one your connected firmware reports, labels it
accordingly (*Check bitmask* versus *Checks to skip*), and edits it as a grid of
per-bit checkboxes with a raw numeric box beside it for pasting a value you
already have.

.. warning::

   Because the sense is inverted, a bitmask value copied from a 4.6 aircraft is
   actively dangerous on 4.7 — ``ARMING_CHECK = 1`` meant *run everything*,
   while :param:`ARMING_SKIPCHK` ``= 1`` means *skip the barometer check*. Do not
   move the number across by hand. Restoring a 4.6 backup onto 4.7 firmware is
   flagged as a version mismatch in the :doc:`../parameters` tab's import diff
   for exactly this reason.

Upgrading an aircraft from 4.6 to 4.7 does the conversion for you, once, on the
first boot: if the old ``ARMING_CHECK`` was left at a value with the *All* bit
set, the new parameter becomes 0 (run everything); if it had specific bits
selected, they are inverted into the equivalent skip mask; and if it was 0 —
which used to mean *no checks* — the new parameter becomes ``-1``, preserving the
old behaviour of running nothing. The result is saved, so it happens once and
does not re-run.

The check bits are the same set on both, only the polarity differs:

1 Barometer · 2 Compass · 3 GPS lock · 4 INS · 5 Parameters · 6 RC Channels ·
7 Board voltage · 8 Battery Level · 10 Logging Available · 11 Hardware safety
switch · 12 GPS Configuration · 13 System · 14 Mission · 15 Rangefinder ·
16 Camera · 17 AuxAuth · 18 VisualOdometry · 19 FFT

.. note::

   Some checks cannot be turned off by either parameter. **Mandatory checks** —
   RC input calibration, and the serial-protocol check described below — run
   even on a deliberately forced arm.

Checks you cannot skip
----------------------

The most commonly hit mandatory check is:

   ``Multiple SERIAL ports configured for RC input``

More than one ``SERIALn_PROTOCOL`` is set to RC Input (23). ArduPilot binds the
**lowest-numbered** such port to the receiver and warns about the others at
boot, so the extra ports are not merely redundant — they are a configuration
error the firmware refuses to arm through. Fix it on the :doc:`ports-serial`
tab, which explains how to find the stray port.

Disabling checks
----------------

There are legitimate reasons to skip a check — a bench session with no GPS, a
compass-less build, an indoor optical-flow aircraft. There is no legitimate
reason to skip one because it keeps failing and you would rather fly.

.. warning::

   A pre-arm check that fails on the bench describes a fault that will still be
   there in the air. Skipping the check does not fix the fault; it removes the
   last warning you were going to get about it. Fix it, then re-check the box.

If you do skip a check, skip that specific bit rather than reaching for *All* /
``-1``, and put it back when the temporary reason is gone.

Arming with the sticks
----------------------

:param:`ARMING_RUDDER` controls whether the rudder (yaw) stick can arm and
disarm the vehicle. On ArduCopter it defaults to **2 — ArmOrDisarm**: hold yaw
right to arm, yaw left to disarm. ``1`` allows arming only, and ``0`` disables
stick arming so that only a ground-station command or an auxiliary switch can
arm.

Rudder arming only acts with the throttle at zero, within the throttle
channel's deadzone (``RCn_DZ``), and some flight modes refuse it regardless.

.. note::

   ``ARMING_REQUIRE`` appears in the Arming card only on **ArduPlane and
   ArduRover** — the parameter does not exist on ArduCopter, so the field will
   not render on a Copter build. This is the firmware's doing, not a gap in the
   configurator.

.. warning::

   The moment arming succeeds, the props are live. Bench work belongs behind
   removed propellers; see the motor-test guards described on
   :doc:`outputs-motors`.

For the full check-by-check reference and each failure message's meaning, the
ArduPilot wiki is canonical: `Arming / Disarming
<https://ardupilot.org/copter/docs/arming_the_motors.html>`__ and
`Prearm Safety Checks
<https://ardupilot.org/copter/docs/common-prearm-safety-checks.html>`__.
