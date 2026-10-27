Receiver
========

The **Receiver** tab sets up and checks your RC link: which channel drives
which axis, how far each stick travels, which way each axis moves, the bind, RSSI
reporting, and flight-mode assignment. A live monitor shows the incoming channels
in real time.

Live monitor
------------

The left column shows live RC input (a stick/craft preview plus per-channel
bars), so you can confirm the receiver is talking to the flight controller before
you change anything. If it reads "No RC telemetry", the receiver isn't being
seen yet. Check the serial port assignment (see :doc:`ports-serial`) and the
bind.

Mapping
-------

Mapping sets which physical channel carries roll, pitch, throttle, and yaw
(``RCMAP_*``). Use the guided mapping, one axis at a time: move the stick it
asks for, and the app detects which channel responded.

Endpoints
---------

Endpoints records the minimum, centre (trim), and maximum of each channel
(``RCn_MIN`` / ``RCn_TRIM`` / ``RCn_MAX``) while you move the sticks to their
extremes.

Channel direction
~~~~~~~~~~~~~~~~~~

Under Endpoints, the **Channel direction** check confirms that each axis moves
the right way. Move each stick the way it is labelled (*roll right*, *pitch up*,
*throttle up*, *yaw right*). The app reads the live channel and reports
**correct** or **backwards** for that axis.

.. note::

   The check reads what ArduPilot will do with the current ``RCn_REVERSED``
   setting. For pitch, *pitch up* means pulling the stick back.

Any axis that reads backwards shows a one-click **Reverse** button. It stages an
``RCn_REVERSED`` change like any other edit. Apply it, then move the stick again
to confirm it now reads correct.

.. warning::

   In :doc:`../guided-setup`, the Receiver step **blocks sign-off** until every
   axis reads correct. On the Receiver tab itself this check is advisory.

Bind (ELRS / CRSF)
------------------

The **Bind RX** button (under the live monitor) puts an ExpressLRS or Crossfire
receiver into bind mode. It sends ``MAV_CMD_START_RX_PAIR``, and ArduPilot
forwards the bind command to the receiver over the CRSF link. Put your
transmitter / ELRS module into bind mode at the same time. The receiver's LED
confirms when it pairs. (The flight controller does not report bind completion,
so check the receiver itself.)

RSSI and link quality
---------------------

RSSI tells the vehicle how good its own RC link is. It drives the OSD signal
readout and the logged link quality, and it tells you how far out you can fly.
It does **not** arrive automatically. :param:`RSSI_TYPE` tells ArduPilot where
to get it. A wrong value is the usual reason an OSD shows a flat 0 % or a stuck
100 %.

The **Advanced** task on this tab has a *Receiver signal setup* card with the
source dropdown, the channel settings, and a **live RX RSSI** readout. Use it to
check that the reading makes sense before you fly. The same source dropdown also
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
       endpoints. These are not on this card; set them from the
       :doc:`../parameters` tab.
   * - 2
     - RC channel PWM
     - The receiver maps RSSI onto a spare RC channel as a PWM value. Set
       :param:`RSSI_CHANNEL` to that channel and :param:`RSSI_CHAN_LOW` /
       :param:`RSSI_CHAN_HIGH` to the PWM it produces at worst and best signal.
   * - 3
     - Receiver protocol
     - **The normal choice for CRSF / ExpressLRS, FPort, and Ghost.** The RC
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

A link like **mLRS** carries the RC channels inside MAVLink instead of over a
dedicated RC serial protocol. The port is set to MAVLink2, and the RC channels
arrive as ``RADIO_RC_CHANNELS`` messages, enabled by **bit 16** (*MAVRadio*) of
:param:`RC_PROTOCOLS`.

With this setup, ``RSSI_TYPE = 3`` (*Receiver protocol*) reads **nothing**. The
MAVLink-radio RC backend passes ArduPilot the channel values and the failsafe
flag but no RSSI, so the firmware records RSSI as unknown. The link's signal
strength arrives in the radio's own ``RADIO_STATUS`` messages instead.

Set :param:`RSSI_TYPE` to **5 — Telemetry radio RSSI**. ArduPilot then takes
the RSSI byte from the most recent ``RADIO_STATUS`` and scales it to 0–100 %.
It falls back to 0 if the radio reports "unknown" or stops sending for five
seconds.

.. note::

   Value 5 works on ArduPilot 4.6 as well as 4.7, but the app's parameter
   metadata lists it only for 4.7. On an older build the dropdown stops at 4
   and typing 5 is flagged as out of range. Use **Override and write anyway** in
   the :doc:`../parameters` tab to set it. The firmware accepts it.

Flight modes
------------

Assigning flight modes to a transmitter switch has its own tab (see
:doc:`flight-modes`). The **Flight Mode** task on this tab is the same
assignment with a live switch exerciser, so you can flick through the detents
and watch which slot each one selects. See also :doc:`../guided-setup`
for the mode-assignment step.
