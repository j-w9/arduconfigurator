Ports & Serial
==============

The **Ports** tab assigns each serial port's **protocol** — what the autopilot
expects to talk to on that UART — along with its baud rate, flow control, and line
options. Getting RC input, telemetry, and GPS onto the right ports here is what
makes the rest of setup work.

The port matrix
---------------

Each row is one UART, shown by its board name (``UART6``) and its ``SERIALn``
label, with five columns:

- **Function** — the protocol, editing ``SERIALn_PROTOCOL``. The dropdown leads
  with the common choices (MAVLink2, GPS, ESC Telemetry, RC Input, Scripting,
  MSP, SmartAudio, DisplayPort) and lists the rest alphabetically.
- **Baud** — a preset list (9600 … 2,000,000) plus a custom entry, editing
  ``SERIALn_BAUD``. Baud is shown as the **actual bit rate** (e.g. 115,200), not
  ArduPilot's coded value.
- **Flow** — hardware flow control, editing ``BRD_SERn_RTSCTS`` (Disabled,
  Enabled, Auto, RS-485 RTS) on ports 1–6.
- **Options** — a per-bit editor for ``SERIALn_OPTIONS`` (invert RX/TX, half
  duplex, swap RX/TX, pull-ups, no-DMA, and so on), opened with the **Bitmask**
  button on the row.

.. note::

   ``SERIAL0`` is the **USB / console** port and is read-only — you can't
   repurpose it. The protocol numbers match ArduPilot exactly: MAVLink1 = 1,
   MAVLink2 = 2, GPS = 5, ESC Telemetry = 16, **RC Input = 23**, MSP = 32. A
   value of ``-1`` (None) disables the port.

Paired peripheral settings
--------------------------

A serial protocol alone isn't always enough to bring a peripheral up — the
peripheral itself has to be enabled too. When you pick one of these, Ports also
**stages the paired parameter** so it works without a second trip, shown as a
note under the Function dropdown:

- **MSP DisplayPort** also stages ``OSD_TYPE = 5`` (the MSP DisplayPort OSD
  backend).
- **IRC Tramp** or **SmartAudio** also stages ``VTX_ENABLE = 1`` and sets the
  matching transport bit in ``VTX_TYPES``.

These are staged as visible, revertible drafts applied **together** with the
``SERIALn_PROTOCOL`` change — nothing is written until you apply — and are
skipped if the value is already correct.

Assigning RC input
------------------

For a serial receiver (CRSF/ELRS, etc.), set the port wired to the receiver's
RX/TX to **RC Input** (``SERIALn_PROTOCOL = 23``). Once that's set and the board
has rebooted, the :doc:`receiver` tab's live monitor should show channels.

Only one port may be RC input
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ArduPilot accepts **exactly one** serial RC input port. It walks the ports in
ascending order at boot, binds the RC protocol decoder to the first one set to
RC Input, and for every later one emits::

   SERIALn_PROTOCOL: duplicate RCIN not permitted

The lowest-numbered RCIN port wins; the rest are inert. Worse, the condition is
also a **mandatory** pre-arm failure — ``Multiple SERIAL ports configured for RC
input`` — and mandatory checks cannot be switched off with the arming-check
bitmask (see :doc:`arming`). So a stray second RCIN port does not degrade
gracefully; it stops the vehicle arming.

This bites on boards whose factory defaults already claim a UART for RC — a
great many board definitions ship one port defaulted to RC Input — so setting a
second port to RC Input for the receiver you actually wired leaves two
configured. Scan the **Function** column for a second *RC Input* row and set the
one you are not using to **None**.

.. tip::

   The guided setup's **Ports** step checks for this and names the offending
   ports for you: *"SERIAL1, SERIAL7 also set to RCIN — ArduPilot uses only the
   lowest-numbered RC input port and silently ignores the rest."* It reports
   only; you make the change on this tab. See :doc:`../guided-setup`.

Is the port dead, or just mis-configured?
-----------------------------------------

"Nothing is working on that port" has two very different causes, and the flight
controller can tell them apart. It keeps per-UART counters — bytes received,
bytes transmitted, and low-level **framing errors** — and publishes them as the
onboard file ``@SYS/uarts.txt``, which you can read yourself from the
:doc:`../files` tab.

Read them like this:

- **RX bytes not increasing.** Nothing is arriving. That is a wiring, power, or
  device problem, not a protocol one — check the TX/RX pair is crossed, the
  device is powered, and grounds are common. No amount of parameter changing
  fixes a silent port.
- **RX bytes increasing, framing errors increasing with them.** Bytes are
  arriving but the UART cannot frame them. That is almost always the **wrong
  baud rate**, and occasionally an inversion problem (many receivers need
  ``SERIALn_OPTIONS`` invert bits, or a half-duplex bit). The device is alive and
  talking; the port is listening wrong.
- **RX bytes increasing, framing errors flat, still nothing works.** The link is
  clean and the port is decoding fine — so the **protocol** assignment is wrong
  for what is wired there, or the peripheral needs its own enable parameter (see
  *Paired peripheral settings* above).

.. note::

   The guided setup's **Ports** step applies exactly this reasoning
   automatically. It flags a port receiving traffic it cannot decode — *"is
   receiving 4867 bytes it cannot decode (1508 framing errors) — check the baud
   and protocol for whatever is wired there"* — on **any** protocol, and flags a
   *disabled* port that is nonetheless receiving clean traffic as an unclaimed
   peripheral. It deliberately does **not** flag a port carrying clean traffic on
   a protocol you configured on purpose: it is the garbling that identifies a
   mismatch, not the traffic. USB ports are skipped, since one of them is the
   link you are connected over.

.. warning::

   ``SERIALn_PROTOCOL``, ``SERIALn_OPTIONS``, and ``BRD_SERn_RTSCTS`` are
   **reboot-required** — they only take effect after a reboot. The tab surfaces a
   reboot prompt when a staged change needs one; reboot and re-pull parameters
   before continuing. (Baud changes apply without a reboot.)

Telemetry, GPS & other devices
------------------------------

Set a telemetry radio's port to **MAVLink2** at the matching baud, and a GPS's
port to **GPS** — the sidebar also exposes GPS behavior (``GPS_TYPE``,
``GPS_AUTO_CONFIG``, ``GPS_AUTO_SWITCH``, ``GPS_PRIMARY``) and a live GPS map. The
same matrix covers ESC telemetry, scripting, and OSD/VTX serial links (MSP,
DisplayPort, SmartAudio), among ArduPilot's full set of serial protocols.

.. note::

   The tab highlights staged and invalid changes on each port row. It does not
   police duplicates beyond the RC-input case above — two ports set to GPS, or
   to MAVLink2, are both legal configurations, so assign each device to exactly
   one UART yourself.

For the firmware semantics behind these settings, see the ArduPilot wiki:
`Serial Port Configuration Options
<https://ardupilot.org/copter/docs/common-serial-options.html>`__.
