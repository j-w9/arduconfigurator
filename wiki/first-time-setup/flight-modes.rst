Flight Modes
============

The **Modes** tab assigns a flight mode to each position of a transmitter
switch, and shows you which one the vehicle is actually in. It is a small tab,
but it is the one that decides what happens when you flick a switch in the air —
and the mapping between switch position and mode is less obvious than it looks,
because ArduPilot reads it from raw PWM bands rather than from a switch position
the transmitter reports.

The mode channel
----------------

One RC channel drives the mode selection: :param:`FLTMODE_CH` on ArduCopter
(Rover names the same idea ``MODE_CH``). The tab shows it as the **Mode
channel** card, with the parameter name it is editing in the subtext.

Pick a channel your transmitter drives with a physical switch, and one that is
not already carrying roll, pitch, throttle, or yaw — check the
:doc:`receiver` tab's live monitor to see which channel a switch moves. Setting
:param:`FLTMODE_CH` to 0 disables switch-driven mode changes entirely, leaving
mode selection to the ground station or to an auxiliary-function switch.

.. warning::

   If the mode channel is also claimed by an RC Mixer (``RCL_*``) function, the
   tab flags it — *"This channel also drives an RC Mixer function"*. Two things
   fighting over one channel is a real in-flight hazard; give the mixer function
   a different channel.

The six slots and their PWM bands
---------------------------------

ArduPilot divides the mode channel into six fixed PWM bands and assigns each
band a mode parameter. The boundaries are **not** configurable:

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

The tab renders exactly this table, one row per slot, with the assigned mode as
an inline dropdown and a **live** badge on whichever slot the vehicle is
currently sitting in.

.. note::

   The band is matched against the channel's **raw** PWM as the receiver
   reports it — not against a normalised or endpoint-scaled value. Setting
   ``RCn_MIN`` / ``RCn_MAX`` on the mode channel does not move these
   boundaries. What matters is what your transmitter actually outputs in each
   switch detent, which is what the :doc:`receiver` live monitor shows you.

Two consequences of the bands being fixed and unevenly spaced:

- A **3-position switch** that outputs the usual 1000 / 1500 / 2000 µs lands in
  slots **1, 4 and 6** — not 1, 2, 3. Assign those three slots; the rest are
  unreachable with that switch.
- A channel sitting **at or beyond the extremes** (≤ 800 µs or ≥ 2200 µs) is
  treated as an error condition and the mode is simply not updated, so a
  transmitter mixing a switch onto a channel it also drives to full travel can
  leave the vehicle stuck in its last mode.

A position change must also hold for about **0.2 s** before it is accepted, so a
switch that chatters electrically will not flick the vehicle between modes.

Which modes to put where
------------------------

The **Assigned mode** dropdown lists the modes the connected firmware supports —
Stabilize, Acro, AltHold, Auto, Guided, Loiter, RTL, Circle, Land, Drift, Sport,
Flip, AutoTune, PosHold, Brake, Throw, Avoid_ADSB, Guided_NoGPS, Smart_RTL,
FlowHold, Follow, ZigZag, SystemID, Auto RTL, Turtle, and the heli-specific
entries.

The tab does not prescribe a layout, and this wiki will not either — a cinematic
build and a freestyle build want different switches. Two points are worth making
regardless of layout:

- Keep a **self-levelling recovery mode** reachable without looking down. On a
  fresh build that usually means Stabilize or AltHold on one end of the switch,
  so a bad moment is one flick from level.
- **RTL and Land are not free.** Both depend on a position estimate and on the
  home position being where you think it is; both are also what your failsafes
  will invoke on their own. Configure them deliberately on the :doc:`failsafe`
  tab and test them where you have room, not for the first time when the battery
  failsafe fires.

Modes changed by something other than the switch — a failsafe, a ground-station
command, or an auxiliary-function switch — are still reflected in the **Active
mode** card, which reads the mode straight out of the vehicle's MAVLink
heartbeat. That card is the honest answer to *"what mode is it in right now"*;
the slot table only tells you what the switch is asking for.

:param:`INITIAL_MODE` selects the mode the vehicle boots into before it has seen
any RC input. It is edited from the :doc:`../parameters` tab.

Editing and applying
--------------------

Each slot's dropdown stages a draft like any other parameter edit — nothing
reaches the vehicle until you apply it from the staged-changes bar. A slot whose
parameter has not arrived yet is marked *not synced* rather than shown as a
guess.

**Open Receiver → Flight Mode** jumps to the alternate surface on the
:doc:`receiver` tab, which adds a live switch exerciser: flick through the
detents and watch which slot each one selects, which is the fastest way to
confirm the mapping before you fly it.

.. note::

   On **ArduSub** the tab shows only the live heartbeat mode. Sub binds modes to
   joystick buttons rather than to a six-position channel, so there is no slot
   table to edit. ArduCopter is the validated path.

For the behaviour of each individual mode, the ArduPilot wiki is canonical:
`Copter flight modes <https://ardupilot.org/copter/docs/flight-modes.html>`__.
