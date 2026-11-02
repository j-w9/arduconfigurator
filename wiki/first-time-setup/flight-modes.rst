Flight Modes
============

Flight-mode assignment is on the :doc:`../config` tab, under the **Flight
Modes** category. It assigns a flight mode to each position of a transmitter
switch and shows which mode the vehicle is in. This panel decides what happens
when you flick a switch in the air. The mapping from switch position to mode is
less obvious than it looks, because ArduPilot reads it from raw PWM bands. The
:doc:`receiver` page has the same six slots in its **Flight modes** row, so you
can make the assignment from either place. Both edit the same parameters.

The mode channel
----------------

One RC channel selects the mode: :param:`FLTMODE_CH` on ArduCopter (Rover calls
it ``MODE_CH``). The panel shows it as the **Mode channel** dropdown, with
*Disabled*, *Channel 1 … 16*, or **Custom…** to type a number. The parameter
name it edits is shown beside it. On the Receiver page you do the same thing by
giving a channel the **Flight modes** Function.

Pick a channel that your transmitter drives with a physical switch and that does
not already carry roll, pitch, throttle, or yaw. Use the :doc:`receiver` tab's
live monitor to see which channel a switch moves. Setting :param:`FLTMODE_CH` to
0 turns off switch-driven mode changes. Modes are then set by the ground station
or by an auxiliary-function switch.

.. warning::

   If the mode channel is also used by an RC Mixer (``RCL_*``) function, on a
   firmware that has one, the panel flags it: *"This channel also drives an RC
   Mixer function"*. Two functions on one channel is an in-flight hazard. Move
   the mixer function to a different channel.

The six slots and their PWM bands
---------------------------------

ArduPilot divides the mode channel into six fixed PWM bands and assigns each
band a mode parameter. You **cannot** change the boundaries:

.. list-table::
   :header-rows: 1
   :widths: 12 28 60

   * - Slot
     - Mode-channel PWM
     - Parameter
   * - 1
     - ≤ 1230 µs
     - :param:`FLTMODE1`
   * - 2
     - 1231 – 1360 µs
     - :param:`FLTMODE2`
   * - 3
     - 1361 – 1490 µs
     - :param:`FLTMODE3`
   * - 4
     - 1491 – 1620 µs
     - :param:`FLTMODE4`
   * - 5
     - 1621 – 1749 µs
     - :param:`FLTMODE5`
   * - 6
     - ≥ 1750 µs
     - :param:`FLTMODE6`

The panel shows this table as **Slot · PWM · Mode**, one row per slot. Each row
has the assigned mode as an inline dropdown. The slot the switch is in gets a
**live** badge with the channel's current microseconds.

.. note::

   The band is matched against the channel's **raw** PWM as the receiver
   reports it, with no normalising or endpoint scaling. Setting ``RCn_MIN`` /
   ``RCn_MAX`` on the mode channel does not move these boundaries. What counts
   is what your transmitter outputs in each switch detent. The :doc:`receiver`
   live monitor shows you that.

Because the bands are fixed and unevenly spaced:

- A **3-position switch** that outputs the usual 1000 / 1500 / 2000 µs lands in
  slots **1, 4 and 6**. Assign those three slots. The others can't be reached
  with that switch.
- A channel **at or beyond the extremes** (≤ 800 µs or ≥ 2200 µs) is treated as
  an error and the mode is not updated. If your transmitter mixes a switch onto
  a channel that it also drives to full travel, the vehicle can stay stuck in
  its last mode.

A new position must also hold for about **0.2 s** before it is accepted, so a
switch that chatters electrically will not flick the vehicle between modes.

Which modes to put where
------------------------

The mode dropdown lists the modes the connected firmware supports: Stabilize,
Acro, AltHold, Auto, Guided, Loiter, RTL, Circle, Land, Drift, Sport, Flip,
AutoTune, PosHold, Brake, Throw, Avoid ADS-B, Guided NoGPS, SmartRTL, FlowHold,
Follow, ZigZag, SystemID, Auto RTL, Turtle, and the heli-specific entries. It
also has **Custom…**, which takes a mode number the list does not know. A number
typed there is written as-is, so you can assign a fork's mode before the app has
a name for it.

The tab does not suggest a layout, and neither does this wiki. A cinematic build
and a freestyle build need different switches. Two rules apply to any layout:

- Keep a **self-levelling recovery mode** reachable without looking down. On a
  fresh build that usually means Stabilize or AltHold on one end of the switch,
  so you are one flick from level.
- **RTL and Land have requirements.** Both need a position estimate and a home
  position that is where you think it is. Your failsafes also trigger them.
  Configure them on the :doc:`failsafe` tab and test them where you have room,
  before a battery failsafe triggers them for the first time.

If something other than the switch changes the mode (a failsafe, a
ground-station command, or an auxiliary-function switch), the **Active mode**
card still shows it. That card reads the mode from the vehicle's MAVLink
heartbeat, so it shows the mode the vehicle is in right now. The slot table only
shows what the switch is asking for.

:param:`INITIAL_MODE` sets the mode the vehicle boots into before it has seen
any RC input. Edit it from the :doc:`../parameters` tab.

Modes your firmware adds
------------------------

The dropdown is not a fixed list. The app asks the vehicle to list its own
modes (the MAVLink ``AVAILABLE_MODES`` message). A mode that exists only in
your build, such as a custom mode compiled into a fork or one registered by a
Lua script, appears by name next to the standard ones. A build without those
modes does not offer them.

Two caveats:

- The firmware has to advertise a mode for it to appear here. In ArduCopter that
  means being listed in ``send_available_mode()``. A mode missing from that list
  is invisible to every ground station, not only this one, even if it flies
  fine.
- Modes the firmware marks as not user-selectable are left out of the dropdown,
  because assigning them to a switch would not work.

.. _fiber-mode:

Fiber mode
~~~~~~~~~~

Fiber is a custom mode found on some forks. It is **not** part of upstream
ArduCopter, so this section only applies if your firmware has it. The app shows
it only when the vehicle reports it.

It is a manual cruise mode, closest to PX4's Altitude Cruise. Like AltHold, it
holds barometric altitude on the throttle stick, takes manual yaw, and needs no
position estimate. Roll and pitch work differently: the sticks command the
**rate of change** of lean angle, and the angle is **kept** when you centre the
sticks. The vehicle keeps its tilt and accelerates until drag balances it, then
cruises at a constant velocity. AltHold would return to level and stop.

On entry it locks onto the vehicle's attitude at that moment, so switching in
from forward flight holds that lean. Before you fly it, know that:

- Entering while tilted past ``ANGLE_MAX`` does not hold that angle. The mode
  returns smoothly to the limit, not to level.
- The lock reads the vehicle's actual attitude, disturbances included. Switching
  into Fiber during a gust captures the gust. Enter it when the vehicle is
  settled.

``FIBER_TILT_T`` sets how long a full stick deflection takes to drive the
lean angle to ``ANGLE_MAX``. The commanded tilt rate is ``ANGLE_MAX`` divided by
it. Smaller is snappier, larger is smoother.

Fiber does not self-level and keeps accelerating until drag catches up. Give it
altitude and open space the first time.

Editing and applying
--------------------

Each slot's dropdown stages a draft like any other parameter edit. Nothing
reaches the vehicle until you apply it with **Apply Setup** (or from the
Receiver page's apply dock). A slot whose parameter has not arrived yet shows
*not synced* instead of a guessed value.

To check the mapping before you fly, flick through the detents and watch the
**live** badge move from slot to slot. The :doc:`receiver` page's **Flight
modes** row outlines the live position the same way.

.. note::

   On **ArduSub** the panel shows only the live heartbeat mode. Sub binds modes
   to joystick buttons instead of a six-position channel, so there is no slot
   table to edit. ArduCopter is the validated path.

For how each mode behaves, see the ArduPilot wiki:
`Copter flight modes <https://ardupilot.org/copter/docs/flight-modes.html>`__.
