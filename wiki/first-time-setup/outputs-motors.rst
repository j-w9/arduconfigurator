Outputs & Motors
================

The **Outputs / Motors** tab sets the ESC/output protocol, confirms motor order
and spin direction, and runs a props-off motor test. On ArduCopter it works from
the frame's motor matrix. Plane, Rover, and Sub show a read-only summary of their
output assignments.

Everything is on **one page**. The motor map and the order/direction work sit
top-left, the ESC and range settings below them, and the throttle sliders in a
live column alongside. You can set a protocol and check the result without
leaving the page. (The Servos tab keeps its sub-tabs, because those are separate
subsystems.)

.. warning::

   **Props off for everything on this page.** Remove all propellers before any
   motor test, order check, or direction check, and restrain the vehicle with the
   area clear. Treat a connected, powered vehicle as if it could spin a motor at
   any moment: the test arms the autopilot to do exactly that. The run button
   stays disabled until you confirm props are off and the area is clear.

ESC & protocol
--------------

The **ESC & Protocol** panel sets the frame (``FRAME_CLASS`` / ``FRAME_TYPE``)
and the output protocol, ``MOT_PWM_TYPE``:

- ``0`` Normal, ``1`` OneShot, ``2`` OneShot125, ``3`` Brushed
- ``4`` DShot150, ``5`` DShot300, ``6`` DShot600, ``7`` DShot1200
- ``8`` PWMRange

DShot ESCs can also report RPM back over **bidirectional DShot** (``bdshot``).
It is configured with ``SERVO_BLH_BDMASK`` (the per-output telemetry mask) and
``SERVO_BLH_AUTO``. Frame class/type and ``MOT_PWM_TYPE`` need a reboot.

.. note::

   Bidirectional DShot is a **compile-time firmware feature**. If
   ``SERVO_BLH_BDMASK`` isn't in the synced parameters, your firmware build
   doesn't include bdshot support. Most boards that do support it only offer it
   on the first four (sometimes eight) outputs.

Motor order & direction
-----------------------

The **Motor Setup** panel handles the reorder inline, with an Order tab and a
Direction tab. Both are gated behind the props-off acknowledgement, and one
acknowledgement at the top of the page covers everything on it:

- **Order:** *Run motor wizard* spins each output briefly (about 2.5 s at 6%).
  Click the position on the schematic that moved. This stages the
  ``SERVOn_FUNCTION`` mapping. Apply stages a reboot. When the order already
  matches, the panel moves on to Direction by itself.
- **Direction:** click a motor to spin it and compare against the arrows
  (top-view CW/CCW). A per-motor **Reverse** toggle flips its spin via
  ``SERVO_BLH_RVMASK``. Reverse toggles are only available on a **DShot**
  protocol (``MOT_PWM_TYPE`` 4–7). On PWM ESCs, reverse a motor by swapping any
  two of its three ESC wires.

.. note::

   The schematic draws the **real layout for your frame**. It reads
   ``FRAME_CLASS`` / ``FRAME_TYPE`` and draws that frame's motor positions and
   per-motor spin directions from ArduPilot's motor matrix. An H-frame reads as
   an H, a hexa shows six arms, a Y6 shows its coaxial stacks, and so on. Each
   motor's spin arrow curves above (front) or below (rear) its ring in the
   correct CW/CCW direction. Still confirm each motor physically spins the way
   its arrow shows before flying.

Motor test (props off)
----------------------

The **Test** column spins motors at a set throttle for a set time. Pick a single
output, all motors in sequence, or all at once. Set **Throttle %** (1–100) and
**Duration** (up to 5 s, 30 s in Expert mode). You can drag the throttle slider
or **type** a value into the percent box beside it. Use the slider to find
roughly the right throttle, and type a value when you need exactly 7% for a
repeatable bench test.

The test sends ``MAV_CMD_DO_MOTOR_TEST``. It is gated by eligibility checks (the
vehicle must be connected, disarmed and parameter-synced, with no other guided
action running) plus the physical-safety acknowledgements. The firmware sends no
"test finished" message, so the per-motor timeout on the autopilot is the hard
safety net.

.. warning::

   When testing over USB on the bench, the app asks for an extra acknowledgement.
   Never run a motor test with props on. Confirm each numbered motor is the one
   that spins before trusting the layout.

Spin thresholds (Expert)
------------------------

``MOT_SPIN_ARM`` and ``MOT_SPIN_MIN`` set where your motors start turning and
where thrust begins. ArduPilot's defaults (0.10 and 0.15) were not measured
against any particular build. The point where a motor breaks away depends on
that ESC and that motor. Too low and a motor may not start on arming. Too high
and it lurches.

In Expert mode the Motor Setup panel offers **Measure Spin Thresholds**. It
opens a popout that measures the values:

1. Every motor is driven together at a rising output, starting at 0.01.
2. The motors stay **live and follow the slider**. Raise it slowly until they
   all just break away. You are looking for the edge.
3. Press **They just started spinning**. ``MOT_SPIN_ARM`` lands one 0.03 margin
   above that point, and ``MOT_SPIN_MIN`` another 0.03 above ARM. The firmware
   requires that order.
4. Both values stay editable and are **staged** for you to apply. The wizard
   writes nothing.

The slider covers ``MOT_SPIN_ARM``'s own 0–0.20 range, not a full 0–100%
throttle, so a single 1% step is a real amount of travel.

.. warning::

   The wizard spins **every motor at once**, so the props-off acknowledgement
   gates it the same way as the motor test. Closing the popout stops whatever it
   was spinning. Each command carries a short timeout that acts as a deadman: if
   the browser stops sending (tab closed, page crashed, link dropped), the
   motors stop on their own.

.. note::

   ArduPilot refuses to arm when ``MOT_SPIN_ARM`` is greater than or equal to
   ``MOT_SPIN_MIN``. The wizard cannot produce such a pair. If you edit the
   values by hand, it warns you before you can stage them.

See also :doc:`ports-serial` for ESC telemetry input and :doc:`power-battery` for
the battery monitor. For motor-order diagrams, ESC wiring, and spin-direction
testing, see the ArduPilot wiki:
`Connect ESCs and Motors
<https://ardupilot.org/copter/docs/connect-escs-and-motors.html>`__.
