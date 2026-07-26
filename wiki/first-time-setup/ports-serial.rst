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

   The tab highlights staged and invalid changes on each port row, but does
   **not** detect two ports configured for the same role — assign each device to
   exactly one UART yourself.

For the firmware semantics behind these settings, see the ArduPilot wiki:
`Serial Port Configuration Options
<https://ardupilot.org/copter/docs/common-serial-options.html>`__.
