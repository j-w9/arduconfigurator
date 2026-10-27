Ports & Serial
==============

The **Ports** tab sets each serial port's **protocol** (what the autopilot
expects to talk to on that UART), its baud rate, flow control, and line options.
RC input, telemetry, and GPS each need to be on the right port before the rest
of setup will work.

The port matrix
---------------

Each row is one UART, shown by its board name (``UART6``) and its ``SERIALn``
label, under five columns: **Port**, **Function**, **Baud**, **Flow** and
**Options**.

USB interfaces are named for the cable, not the STM32 peripheral. An ``OTG2``
appears as ``USB1_2 (OTG2)`` and sorts below the solderable UARTs, because it is
a second interface on the USB lead and not a port you wire something to.

- **Function:** the protocol, editing ``SERIALn_PROTOCOL``. The dropdown lists
  the common choices first (MAVLink2, GPS, ESC Telemetry, RC Input, Scripting,
  MSP, SmartAudio, DisplayPort), then the rest alphabetically.
- **Baud:** a preset list (9600 … 2,000,000) plus a custom entry, editing
  ``SERIALn_BAUD``. Baud is shown as the **actual bit rate** (e.g. 115,200), not
  ArduPilot's coded value.
- **Flow:** hardware flow control, editing ``BRD_SERn_RTSCTS`` (Disabled,
  Enabled, Auto, RS-485 RTS) on ports 1–6.
- **Options:** a per-bit editor for ``SERIALn_OPTIONS`` (invert RX/TX, half
  duplex, swap RX/TX, pull-ups, no-DMA, and so on). Open it with the
  **Bitmask** button on the row.

.. note::

   ``SERIAL0`` is the **USB / console** port and is read-only. You can't
   repurpose it. The protocol numbers match ArduPilot exactly: MAVLink1 = 1,
   MAVLink2 = 2, GPS = 5, ESC Telemetry = 16, **RC Input = 23**, MSP = 32. A
   value of ``-1`` (None) disables the port.

Paired peripheral settings
--------------------------

Some peripherals need their own enable setting as well as the serial protocol.
When you pick one of these, Ports also **stages the paired parameter**, so you
don't have to set it elsewhere. A note under the Function dropdown shows it:

- **MSP DisplayPort** also stages ``OSD_TYPE = 5`` (the MSP DisplayPort OSD
  backend).
- **IRC Tramp** or **SmartAudio** also stages ``VTX_ENABLE = 1`` and sets the
  matching transport bit in ``VTX_TYPES``.

These are visible drafts that you can revert. They are applied **together** with
the ``SERIALn_PROTOCOL`` change, and nothing is written until you apply. They
are skipped if the value is already correct.

Assigning RC input
------------------

For a serial receiver (CRSF/ELRS, etc.), set the port wired to the receiver's
RX/TX to **RC Input** (``SERIALn_PROTOCOL = 23``). After you set it and reboot
the board, the :doc:`receiver` tab's live monitor should show channels.

Only one port may be RC input
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ArduPilot accepts **exactly one** serial RC input port. At boot it walks the
ports in ascending order and binds the RC protocol decoder to the first one set
to RC Input. For every later one it emits::

   SERIALn_PROTOCOL: duplicate RCIN not permitted

The lowest-numbered RCIN port wins and the others do nothing. This is also a
**mandatory** pre-arm failure, ``Multiple SERIAL ports configured for RC
input``, and you cannot turn mandatory checks off with the arming-check bitmask
(see :doc:`arming`). A second RCIN port stops the vehicle from arming.

Many board definitions ship with one UART defaulted to RC Input. If you then set
another port to RC Input for the receiver you wired, two are configured. Look in
the **Function** column for a second *RC Input* row and set the one you are not
using to **None**.

.. tip::

   The guided setup's **Ports** step checks for this and names the ports:
   *"SERIAL1, SERIAL7 also set to RCIN — ArduPilot uses only the
   lowest-numbered RC input port and silently ignores the rest."* It only
   reports; you make the change on this tab. See :doc:`../guided-setup`.

Is the port dead, or mis-configured?
------------------------------------

Each row has a small **status dot** that shows whether anything is on the port.
It is judged by the port's *protocol*, not by raw byte counts:

- **Green:** the protocol's own telemetry shows it working. A GPS port shows its
  satellite count, an RC port its channel count, an ESC-telemetry port how many
  ESCs are reporting. This shows the *peripheral* works, which is more than
  bytes on the wire can tell you.
- **Muted:** ArduPilot drives this port and nothing inbound can confirm it. The
  autopilot mostly sends *to* a SmartAudio VTX or a DisplayPort OSD, so silence
  there proves nothing.
- **Hollow:** inbound traffic was expected and there is none. This is the
  state to look into.
- **Absent:** the board has not served ``@SYS/uarts.txt``, so there is no data
  to judge from. The tab tells you so.

.. note::

   A port set to **half-duplex** (``SERIALn_OPTIONS`` bit 2, one-wire) never
   shows received bytes, whatever is attached. ArduPilot does not count RX on a
   half-duplex port. The dot says so, so you don't read the port as quiet.

When nothing works on a port, there are two very different causes, and the
flight controller can tell them apart. It keeps per-UART counters (bytes
received, bytes transmitted, and low-level **framing errors**) and publishes
them as the onboard file ``@SYS/uarts.txt``. The Ports tab reads this file for
the dots above. You can also read it yourself from the :doc:`../files` tab.

Read the counters like this:

- **RX bytes not increasing.** Nothing is arriving. This is a wiring, power, or
  device problem, not a protocol one. Check that the TX/RX pair is crossed, the
  device is powered, and the grounds are common. Changing parameters will not
  fix a silent port.
- **RX bytes increasing, framing errors increasing with them.** Bytes are
  arriving but the UART cannot frame them. This is almost always the **wrong
  baud rate**, and sometimes an inversion problem (many receivers need
  ``SERIALn_OPTIONS`` invert bits, or a half-duplex bit). The device is talking;
  the port is set up wrong to listen.
- **RX bytes increasing, framing errors flat, still nothing works.** The link is
  clean and the port is decoding. The **protocol** assignment is wrong for what
  is wired there, or the peripheral needs its own enable parameter (see
  *Paired peripheral settings* above).

.. note::

   The guided setup's **Ports** step applies these rules automatically. It flags
   a port that receives traffic it cannot decode, on **any** protocol: *"is
   receiving 4867 bytes it cannot decode (1508 framing errors) — check the baud
   and protocol for whatever is wired there"*. It also flags a *disabled* port
   that receives clean traffic, as an unclaimed peripheral. It does not flag
   clean traffic on a protocol you set yourself. Framing errors mark a mismatch,
   traffic alone does not. USB ports are skipped, since one of them is the link
   you are connected over.

.. warning::

   ``SERIALn_PROTOCOL``, ``SERIALn_OPTIONS``, and ``BRD_SERn_RTSCTS`` are
   **reboot-required**. They only take effect after a reboot. The tab prompts
   for a reboot when a staged change needs one. Reboot and re-pull parameters
   before you continue. (Baud changes apply without a reboot.)

Telemetry, GPS & other devices
------------------------------

Set a telemetry radio's port to **MAVLink2** at the matching baud, and a GPS's
port to **GPS**. The same matrix covers ESC telemetry, scripting, and OSD/VTX
serial links (MSP, DisplayPort, SmartAudio), among ArduPilot's full set of
serial protocols.

This tab configures the **UART** only. The settings for the device on the
other end are on **Peripherals → GPS**: the GPS driver and rate (``GPS_TYPE``,
``GPS_AUTO_CONFIG``, ``GPS_RATE_MS``), multi-GPS behaviour
(``GPS_AUTO_SWITCH``, ``GPS_PRIMARY``), the antenna offsets, and a live map to
confirm the aircraft's position. They sit next to the settings that decide
whether you get a fix.

.. note::

   The tab highlights staged and invalid changes on each port row. It only
   checks for duplicates in the RC-input case above. Two ports set to GPS, or
   to MAVLink2, are both legal, so make sure each device is assigned to exactly
   one UART.

For the firmware details behind these settings, see the ArduPilot wiki:
`Serial Port Configuration Options
<https://ardupilot.org/copter/docs/common-serial-options.html>`__.
