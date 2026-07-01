Outputs & Motors
================

The **Outputs / Motors** tab sets the ESC/output protocol, confirms motor order
and spin direction, and runs a props-off motor test. On ArduCopter it works from
the frame's motor matrix; Plane, Rover, and Sub show a read-only summary of their
output assignments instead.

.. warning::

   **Props off for everything on this page.** Remove all propellers before any
   motor test, order check, or direction check, and restrain the vehicle with the
   area clear. Treat a connected, powered vehicle as if it could spin a motor at
   any moment — the test arms the autopilot to do exactly that. The run button
   stays disabled until you confirm props are off and the area is clear.

ESC & protocol
--------------

The **ESC & Protocol** sub-tab sets the frame (``FRAME_CLASS`` / ``FRAME_TYPE``)
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

The **Motor Setup** sub-tab opens the reorder dialog, with an Order tab and a
Direction tab (both gated behind the props-off acknowledgement):

- **Order** — *Identify motors interactively* spins each output briefly (about
  2.5 s at 6%) and you click the position on the schematic that moved, which
  stages the ``SERVOn_FUNCTION`` mapping. Apply stages a reboot.
- **Direction** — click a motor to spin it and compare against the arrows
  (top-view CW/CCW); a per-motor **Reverse** toggle flips its spin via
  ``SERVO_BLH_RVMASK``. Reverse toggles are only available on a **DShot**
  protocol (``MOT_PWM_TYPE`` 4–7); on PWM ESCs you reverse a motor by swapping any
  two of its three ESC wires.

.. note::

   ArduPilot expects motors numbered and spinning in a specific pattern for your
   frame class and type. The schematic only draws spin arrows for frames whose
   direction table is known, so cross-check against the ArduPilot motor-order
   diagram for your exact frame.

Motor test (props off)
----------------------

The **Test** sub-tab spins motors at a set throttle for a set time. Pick a single
output, all motors in sequence, or all at once; set **Throttle %** (1–100) and
**Duration** (up to 5 s, 30 s in Expert mode). It sends
``MAV_CMD_DO_MOTOR_TEST`` and is gated by eligibility checks — the vehicle must be
connected, disarmed, parameter-synced, with no other guided action running — plus
the physical-safety acknowledgements. There's no "test finished" message from the
firmware, so the per-motor timeout on the autopilot is the hard safety net.

.. warning::

   When testing over USB on the bench, the app asks for an extra acknowledgement.
   Never run a motor test with props on, and confirm each numbered motor is the
   one that actually spins before trusting the layout.

See also :doc:`ports-serial` for ESC telemetry input and :doc:`power-battery` for
the battery monitor. For motor-order diagrams, ESC wiring, and spin-direction
testing, see the ArduPilot wiki:
`Connect ESCs and Motors
<https://ardupilot.org/copter/docs/connect-escs-and-motors.html>`__.
