Receiver
========

The **Receiver** tab configures and verifies your RC link: which channel drives
which axis, how far each stick travels, which way each axis moves, the bind, RSSI
reporting, and flight-mode assignment. A live monitor shows the incoming channels
in real time.

Live monitor
------------

The left column shows live RC input — a stick/craft preview plus per-channel
bars — so you can confirm the receiver is talking to the flight controller before
configuring anything. If it reads "No RC telemetry", the receiver isn't being
seen yet; check the serial port assignment (see :doc:`ports-serial`) and the bind.

Mapping
-------

Tells the flight controller which physical channel carries roll, pitch, throttle,
and yaw (``RCMAP_*``). Use the guided, one-axis-at-a-time mapping: move the
prompted stick and the app detects which channel responded.

Endpoints
---------

Captures the minimum, centre (trim), and maximum of each channel (``RCn_MIN`` /
``RCn_TRIM`` / ``RCn_MAX``) by moving the sticks to their extremes.

Channel direction
~~~~~~~~~~~~~~~~~~

Under Endpoints, the **Channel direction** check verifies each axis moves the
right way. Move each stick the way it's labelled — *roll right*, *pitch up*,
*throttle up*, *yaw right* — and the app reads the live channel and reports
**correct** or **backwards** for that axis.

.. note::

   Detection is reversal-aware: it reflects what ArduPilot will actually do with
   the current ``RCn_REVERSED`` setting. Pitch is the classic case — most Mode-2
   transmitters need ``RC2_REVERSED`` set so that pulling back commands pitch-up.

Any axis that reads backwards shows a one-click **Reverse** button, which stages
an ``RCn_REVERSED`` change like any other edit (apply it, then move the stick
again to confirm it now reads correct).

.. warning::

   In :doc:`../guided-setup`, the Receiver step **blocks sign-off** until every
   axis reads correct. In the regular Receiver tab this check is advisory.

Bind (ELRS / CRSF)
------------------

The **Bind RX** button (under the live monitor) puts an ExpressLRS or Crossfire
receiver into bind mode. It sends ``MAV_CMD_START_RX_PAIR``; ArduPilot forwards
the bind command to the receiver over the CRSF link. Put your transmitter / ELRS
module into bind mode at the same time — the receiver's LED confirms when it
pairs. (The flight controller does not report bind completion, so confirm at the
receiver itself.)

RSSI and link quality
---------------------

RSSI is how the vehicle learns how good its own RC link is — it drives the OSD
signal readout, the logged link quality, and your judgement about how far out to
fly. It does **not** arrive automatically: ArduPilot has to be told *where* to
get it, with :param:`RSSI_TYPE`. Getting this wrong is the usual reason an OSD
shows a flat 0 % or a stuck 100 %.

The **Advanced** task on this tab has a *Receiver signal setup* card with the
source dropdown, the channel settings, and a **live RX RSSI** readout so you can
confirm the choice reads sensibly before you fly. The same source dropdown also
appears on the :doc:`../config` tab under **RC → Receiver & signal**.

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
       endpoints, which are not on this card — set them from the
       :doc:`../parameters` tab.
   * - 2
     - RC channel PWM
     - The receiver maps RSSI onto a spare RC channel as a PWM value. Set
       :param:`RSSI_CHANNEL` to that channel and :param:`RSSI_CHAN_LOW` /
       :param:`RSSI_CHAN_HIGH` to the PWM it produces at worst and best signal.
   * - 3
     - Receiver protocol
     - **The normal choice for CRSF / ExpressLRS, FPort, and Ghost.** The RC
       protocol itself carries RSSI, so nothing else needs configuring. This is
       also the only source that yields a separate *link quality* figure.
   * - 4
     - PWM input pin
     - The receiver emits RSSI as a PWM duty cycle on a pin.
   * - 5
     - Telemetry radio RSSI
     - RSSI is taken from the ``RADIO_STATUS`` messages a MAVLink telemetry
       radio sends. See below.

MAVLink-carried RC (mLRS and similar)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A link like **mLRS** carries the RC channels inside MAVLink rather than over a
dedicated RC serial protocol: the port is set to MAVLink2, and the RC channels
arrive as ``RADIO_RC_CHANNELS`` messages, enabled by the *MAVRadio* bit —
**bit 16** — of :param:`RC_PROTOCOLS`.

For that setup, ``RSSI_TYPE = 3`` (*Receiver protocol*) reads **nothing**. The
MAVLink-radio RC backend hands ArduPilot the channel values and the failsafe
flag and nothing else; there is no RSSI field in that path, so the firmware
records it as unknown. The link's signal strength instead arrives separately, in
the radio's own ``RADIO_STATUS`` messages.

So set :param:`RSSI_TYPE` to **5 — Telemetry radio RSSI**. ArduPilot then takes
the RSSI byte out of the most recent ``RADIO_STATUS``, scales it to 0–100 %, and
falls back to 0 if the radio reports "unknown" or stops sending for five
seconds.

.. note::

   Value 5 works on ArduPilot 4.6 as well as 4.7, but the configurator's
   parameter metadata only lists it for 4.7 firmware. On an older build the
   dropdown stops at 4 and typing 5 is flagged as out of range — use **Override
   and write anyway** in the :doc:`../parameters` tab to set it. The firmware
   accepts it.

Flight modes
------------

Assigning flight modes to a transmitter switch has its own tab — see
:doc:`flight-modes`. The **Flight Mode** task on this tab is the same
assignment with a live switch exerciser attached, so you can flick through the
detents and watch which slot each one selects. See also :doc:`../guided-setup`
for the mode-assignment step.
