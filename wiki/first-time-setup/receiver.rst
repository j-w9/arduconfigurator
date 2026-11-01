Receiver
========

The **Receiver** tab sets up and checks your RC link on one page: which channel
drives which axis, how far each stick travels, which way each axis moves, and
which switch picks the flight mode. Every row shows what the receiver is sending
now, so you can confirm it is talking to the flight controller before you change
anything.

If the rows show no RC data, the receiver isn't being seen yet. Check the serial
port assignment (see :doc:`ports-serial`) and the bind. Eight flat rows and "no
RC data" look alike, so move a stick: a live channel moves with it.

Map
---

The **Map** card shows a small craft that tilts and lifts with the sticks. It
sets which channel carries roll, pitch, throttle and yaw (``RCMAP_*``). Pick an
axis from a channel's **Function** dropdown in the table below. Or press
**Guided Mapping** and move one stick at a time: the app finds the channel that
moves alone and stages the detected map. If you pick an axis that another
channel already has, the two swap. ``RCMAP`` changes take effect after a reboot.

Channels
--------

There is one row per channel the flight controller reports, with:

- **Function:** what the channel does. The dropdown lists Roll / Pitch /
  Throttle / Yaw first, then *Do Nothing*, *Flight modes* (this channel becomes
  the mode switch, :param:`FLTMODE_CH`), then ArduPilot's full ``RCn_OPTION``
  list: *ArmDisarm*, *Motor Emergency Stop*, *AirMode*, *Camera Trigger*,
  *Relay1 On/Off* and the rest. Each channel has one job. **Custom…** takes an
  option number the list does not know, for a fork's new option.
- The **live value** in microseconds, with a bar between the channel's low and
  high.
- **Direction:** for roll, pitch, throttle and yaw. It shows *✓ correct*, *⚠
  backwards, tick Reverse*, or *— move to test* until the stick has moved far
  enough to judge.
- **Reverse:** ticks :param:`RC1_REVERSED` … ``RC16_REVERSED`` for a channel
  the flight controller reads backwards. It is staged like every other change.
- **Endpoints ▸:** opens the **Low · Trim · High (µs)** fields (``RCn_MIN`` /
  ``RCn_TRIM`` / ``RCn_MAX``) for every channel. **Start Capture** records them
  from the sticks. Start centred with the throttle low, move each stick through
  its full travel, flick the switches low and high, and stage the captured
  values. **Set CRSF Limits** writes the fixed CRSF / ELRS range (987 – 2011
  µs, centre 1500) in one click. A CRSF link does not need a capture.

Channel direction
~~~~~~~~~~~~~~~~~~

**Check Sticks** runs the direction check. Move each stick the way it is
labelled (*roll right*, *pitch up* = stick back, *throttle up*, *yaw right*).
The **Direction** column shows *correct* or *backwards* for that axis. The craft
in the Map card moves with the sticks, so a backwards axis shows there too.

.. note::

   The check reads what ArduPilot will do with the current ``RCn_REVERSED``
   setting. Pitch is the axis most often backwards on a fresh transmitter
   model.

Tick **Reverse** on the row that reads backwards, apply, and move the stick
again to confirm it now reads correct.

.. warning::

   In :doc:`../guided-setup`, the **Radio** step **blocks sign-off** until every
   axis reads correct. On the Receiver tab itself this check is advisory.

Flight modes and the arm switch
-------------------------------

At the top of the page, **Flight modes** shows the mode channel
(:param:`FLTMODE_CH`) and one dropdown per switch position, FLTMODE1 …
FLTMODE6. The switch's current position is outlined, so flick through every
detent. A channel whose Function is *ArmDisarm* appears next to it as the **Arm
switch**, with *AirMode when armed by this switch* as its option. A slot set to
Acro shows the Acro trainer options under the modes. This is the only place the
slots are edited. :doc:`flight-modes` explains the fixed PWM bands.

Applying
--------

Edits stage as drafts, and nothing reaches the vehicle until you apply them. A
dock at the bottom of the tab shows the staged count, **Show changes** to list
each draft, and the apply and discard buttons. ``RCMAP_*`` and ``FLTMODE_CH``
changes need a reboot. The app tells you after the write.

Bind (ELRS / CRSF)
------------------

ArduPilot can forward a bind command to an ExpressLRS or Crossfire receiver over
the CRSF link (``MAV_CMD_START_RX_PAIR``). The **Bind RX** button is not shown
in this release. Bind from the receiver's button or the transmitter's ELRS
module as usual. The receiver's LED confirms the pair, since the flight
controller does not report it.

RSSI and link quality
---------------------

RSSI drives the OSD signal readout and the logged link quality.
:param:`RSSI_TYPE` tells ArduPilot where to get it. A wrong value is the usual
reason an OSD shows a flat 0 % or a stuck 100 %.

The source dropdown and the channel settings (:param:`RSSI_CHANNEL`,
:param:`RSSI_CHAN_LOW` / :param:`RSSI_CHAN_HIGH`) are not on this page. They are
on the :doc:`../config` tab under **RC**, in the **Receiver** card next to
``RC_PROTOCOLS``, ``RC_OPTIONS`` and the RC input rate.

Pick the source that matches how your receiver reports:

.. list-table::
   :header-rows: 1
   :widths: 10 26 64

   * - Value
     - Source
     - Use it when
   * - 0
     - Disabled
     - No RSSI reporting at all.
   * - 1
     - Analog pin
     - The receiver outputs an analog RSSI voltage to a spare ADC pin. Needs
       ``RSSI_ANA_PIN`` and the ``RSSI_PIN_LOW`` / ``RSSI_PIN_HIGH`` voltage
       endpoints. These are not on that card; set them from the
       :doc:`../parameters` tab.
   * - 2
     - RC channel PWM
     - The receiver maps RSSI onto a spare RC channel as a PWM value. Set
       :param:`RSSI_CHANNEL` to that channel and :param:`RSSI_CHAN_LOW` /
       :param:`RSSI_CHAN_HIGH` to the PWM it produces at worst and best signal.
   * - 3
     - Receiver protocol
     - The normal choice for CRSF / ExpressLRS, FPort and Ghost. The RC
       protocol carries RSSI, so nothing else needs configuring. This is also
       the only source that gives a separate *link quality* figure.
   * - 4
     - PWM input pin
     - The receiver emits RSSI as a PWM duty cycle on a pin.
   * - 5
     - Telemetry radio RSSI
     - RSSI is taken from the ``RADIO_STATUS`` messages a MAVLink telemetry
       radio sends. See below.

MAVLink-carried RC (mLRS and similar)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A link like **mLRS** carries the RC channels inside MAVLink. The port is set to
MAVLink2, and the RC channels arrive as ``RADIO_RC_CHANNELS`` messages, enabled
by bit 16 (*MAVRadio*) of :param:`RC_PROTOCOLS`.

With this setup, ``RSSI_TYPE = 3`` (*Receiver protocol*) reads nothing. The
MAVLink-radio RC path carries channel values and the failsafe flag but no RSSI,
so the firmware records RSSI as unknown. The link's signal strength arrives in
the radio's ``RADIO_STATUS`` messages instead.

Set :param:`RSSI_TYPE` to **5 — Telemetry radio RSSI**. ArduPilot then takes
the RSSI byte from the most recent ``RADIO_STATUS`` and scales it to 0–100 %.
It falls back to 0 if the radio reports "unknown" or stops sending for five
seconds.

.. note::

   Value 5 works on ArduPilot 4.6 as well as 4.7, but the app's parameter
   metadata lists it only for 4.7. On an older build the dropdown stops at 4
   and typing 5 is flagged as out of range. Use **Override and write anyway** in
   the :doc:`../parameters` tab to set it. The firmware accepts it.
