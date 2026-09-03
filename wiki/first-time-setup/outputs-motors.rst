Outputs & Motors
================

The **Outputs / Motors** tab sets the ESC/output protocol, confirms motor order
and spin direction, and runs a props-off motor test. On ArduCopter it works from
the frame's motor matrix; Plane, Rover, and Sub show a read-only summary of their
output assignments instead.

Everything is on **one page**. The motor map and the order/direction work sit
top-left, the ESC and range settings below them, and the throttle sliders in a
live column alongside — so setting a protocol no longer means leaving the page
you were checking the result on. (The Servos tab keeps its sub-tabs; those are
genuinely separate subsystems rather than three views of one job.)

.. warning::

   **Props off for everything on this page.** Remove all propellers before any
   motor test, order check, or direction check, and restrain the vehicle with the
   area clear. Treat a connected, powered vehicle as if it could spin a motor at
   any moment — the test arms the autopilot to do exactly that. The run button
   stays disabled until you confirm props are off and the area is clear.

ESC & protocol
--------------

The **ESC & Protocol** panel sets the frame (``FRAME_CLASS`` / ``FRAME_TYPE``)
and the output protocol, ``MOT_PWM_TYPE``:

- ``0`` Normal, ``1`` OneShot, ``2`` OneShot125, ``3`` Brushed
- ``4`` DShot150, ``5`` DShot300, ``6`` DShot600, ``7`` DShot1200
- ``8`` PWMRange

DShot ESCs can also report RPM back over **bidirectional DShot** (``bdshot``),
configured with ``SERVO_BLH_BDMASK`` (the per-output telemetry mask) alongside
``SERVO_BLH_AUTO``. Frame class/type and ``MOT_PWM_TYPE`` are reboot-required.

.. note::

   Bidirectional DShot is a **compile-time firmware feature**. If
   ``SERVO_BLH_BDMASK`` isn't present in the synced parameters, your firmware
   build doesn't include bdshot support — and most boards that do support it only
   offer it on the first four (sometimes eight) outputs.

Motor order & direction
-----------------------

The **Motor Setup** panel carries the reorder work inline, with an Order tab and
a Direction tab (both gated behind the props-off acknowledgement — one
acknowledgement at the top of the page covers everything on it):

- **Order** — *Identify motors interactively* spins each output briefly (about
  2.5 s at 6%) and you click the position on the schematic that moved, which
  stages the ``SERVOn_FUNCTION`` mapping. Apply stages a reboot.
- **Direction** — click a motor to spin it and compare against the arrows
  (top-view CW/CCW); a per-motor **Reverse** toggle flips its spin via
  ``SERVO_BLH_RVMASK``. Reverse toggles are only available on a **DShot**
  protocol (``MOT_PWM_TYPE`` 4–7); on PWM ESCs you reverse a motor by swapping any
  two of its three ESC wires.

.. note::

   The schematic draws the **real layout for your frame**. It reads
   ``FRAME_CLASS`` / ``FRAME_TYPE`` and renders that frame's actual motor
   positions and per-motor spin directions from ArduPilot's motor matrix — so an
   H-frame reads as an H, a hexa shows six arms, a Y6 shows its coaxial stacks,
   and so on, rather than always drawing a quad-X. Each motor's spin arrow
   curves above (front) or below (rear) its ring in the correct CW/CCW
   direction. Still confirm each motor physically spins the way its arrow shows
   before flying.

Motor test (props off)
----------------------

The **Test** column spins motors at a set throttle for a set time. Pick a single
output, all motors in sequence, or all at once; set **Throttle %** (1–100) and
**Duration** (up to 5 s, 30 s in Expert mode). The throttle can be dragged on
the slider or **typed** into the percent box beside it — a slider is the fast
way to find roughly the right throttle and a poor way to ask for exactly 7%,
which is what a repeatable bench test wants. It sends
``MAV_CMD_DO_MOTOR_TEST`` and is gated by eligibility checks — the vehicle must be
connected, disarmed, parameter-synced, with no other guided action running — plus
the physical-safety acknowledgements. There's no "test finished" message from the
firmware, so the per-motor timeout on the autopilot is the hard safety net.

.. warning::

   When testing over USB on the bench, the app asks for an extra acknowledgement.
   Never run a motor test with props on, and confirm each numbered motor is the
   one that actually spins before trusting the layout.

Spin thresholds (Expert)
------------------------

``MOT_SPIN_ARM`` and ``MOT_SPIN_MIN`` decide where your motors start turning and
where thrust begins. ArduPilot's defaults — 0.10 and 0.15 — were never measured
against any particular build, and where a motor actually breaks away is a
property of *that* ESC and *that* motor. Too low and a motor may not start on
arming; too high and it lurches.

In Expert mode the Motor Setup panel offers **Measure Spin Thresholds**, which
opens a popout that measures it instead of guessing:

1. Every motor is driven together at a rising output, starting at 0.01.
2. The motors stay **live and follow the slider** — raise it slowly until they
   all just break away. (This is why it is a measurement, not a sample: you are
   looking for the edge.)
3. Press **They just started spinning**. ``MOT_SPIN_ARM`` lands one 0.03 margin
   above that point, and ``MOT_SPIN_MIN`` another 0.03 above ARM — the ordering
   the firmware requires.
4. Both values stay editable, and are **staged** for you to apply. Nothing is
   written by the wizard.

The slider covers ``MOT_SPIN_ARM``'s own 0–0.20 range rather than a full
0–100% throttle, so a single 1% step is a real amount of travel.

.. warning::

   The wizard spins **every motor at once**, so the props-off acknowledgement
   gates it exactly like the motor test. Closing the popout stops whatever it
   was spinning, and each command carries a short timeout that acts as a
   deadman: if the browser stops sending — tab closed, page crashed, link
   dropped — the motors stop on their own without anyone pressing anything.

.. note::

   ArduPilot refuses to arm when ``MOT_SPIN_ARM`` is greater than or equal to
   ``MOT_SPIN_MIN``. The wizard cannot produce such a pair, and if you edit the
   values by hand it says so before you can stage them.

See also :doc:`ports-serial` for ESC telemetry input and :doc:`power-battery` for
the battery monitor. For motor-order diagrams, ESC wiring, and spin-direction
testing, see the ArduPilot wiki:
`Connect ESCs and Motors
<https://ardupilot.org/copter/docs/connect-escs-and-motors.html>`__.
