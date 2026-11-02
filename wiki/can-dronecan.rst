CAN & DroneCAN
==============

The **CAN** tab handles the CAN bus. It discovers DroneCAN nodes, edits and
saves their parameters, restarts or updates them, shows ESC telemetry, decodes
every message on the wire and plots any of it live. It is available without
Expert mode. Each device can **Pop out** into its own window, so you can watch
several side by side.

How the bus is reached
----------------------

There are two ways to reach the bus. With a vehicle connected, **Connect to CAN1** (or CAN2) sends
``MAV_CMD_CAN_FORWARD`` and the autopilot tunnels that bus's raw ``CAN_FRAME``
messages over the MAVLink link you already have. Telemetry keeps flowing and the
flight controller never switches into SLCAN mode.

Without a vehicle (a bench bus, or a node on its own), **Use a USB-CAN
adapter** opens an SLCAN adapter over Web Serial at the **Bitrate** you pick.
The autopilot's own SLCAN port works too. On a bench bus with no autopilot to
hand out node IDs, the tab's **node ID allocation** can do it. It stays off when
another allocator is already on the bus.

.. note::

   ArduPilot stops forwarding CAN frames about 5 seconds after the last
   ``MAV_CMD_CAN_FORWARD``. The app re-arms it about every 2 s while a bus is
   active, so the stream does not lapse. If a node goes quiet, check the bus
   first; the tunnel is rarely the cause.

Outbound DroneCAN service calls (parameter reads/writes, restart, firmware
file-serving) are sent as extended ``CAN_FRAME`` messages on the same tunnel.
The tunnel is best-effort, so the app retries lost requests.

.. tip::

   **Enable the CAN bus?** A common mistake is setting a peripheral's driver to
   DroneCAN without turning on the CAN interface. There is no error. The node is
   powered and on the wire, but invisible. The app watches for :param:`GPS_TYPE`
   or :param:`GPS_TYPE2` = 9 / 22 / 23 (DroneCAN and its two moving-baseline
   variants), :param:`BATT_MONITOR` or :param:`BATT2_MONITOR` = 8, and
   :param:`FLOW_TYPE` = 6.

   When one of those is selected but CAN bus 1 is not enabled for DroneCAN, a
   one-click **Enable CAN bus & reboot** prompt writes ``CAN_P1_DRIVER = 1``
   (bind physical interface 1 to virtual driver 1) and ``CAN_D1_PROTOCOL = 1``
   (run DroneCAN on that driver) after an automatic backup. Both need a reboot;
   nodes appear after it. The prompt shows on the CAN tab, and for
   :param:`FLOW_TYPE` also on Peripherals › Flow & Lidar
   (:doc:`first-time-setup/peripherals-gimbal`).

The sub-tabs
------------

Once a bus is live, a status line reads the node count and frame rate, and five
sub-tabs divide the work: **Devices · Messages · Frames · Plot · Send**.

Devices
~~~~~~~

A rail lists **All devices**, then one entry per node with its name
(``org.ardupilot.ap_periph``, ``com.hex.here3`` …), id, health and mode (*Node
124 · OK · Operational*). Nodes are found from their ``NodeStatus`` broadcasts
and named by a ``GetNodeInfo`` poll. The autopilot's own node is labelled
**Autopilot (this FC)**; its parameters live on MAVLink, not DroneCAN. Each
node's card has four tabs:

- **Params (n):** the node's parameter table, read over
  ``uavcan.protocol.param.GetSet``. Enums get dropdowns, bitmasks get bit grids,
  and read-only values are marked. Edits stage, and a comparison panel shows
  *current → new* per row (**Discard** a row or **Discard All**). **Apply
  All (n)** writes the set. ``GetSet`` writes are RAM-only, so once every write
  is acknowledged the app sends an ``ExecuteOpcode`` SAVE. Without it, changes
  revert at the next power cycle. The parameters are re-read after the save, a
  reboot, a bootloader flash or a firmware update, so the grid shows what is
  stored. A stalled read offers **Re-fetch params**. A change that needs a
  reboot offers one.
- **Details:** hardware and software version, git hash and unique id, uptime
  and last-seen age.
- **Actions:** **Reboot node** (``uavcan.protocol.RestartNode``, behind a
  confirm), **Flash bootloader**, **Change node ID** (**Save and restart**), and
  the firmware update below. With **Flash bootloader**, an AP_Periph node
  updates its own bootloader from the firmware it carries. The app waits a
  minute for an answer, and reads *unchanged* when the installed one was
  already current.
- **Pop out:** the same card in its own window.

Below the rail, **Node messages** shows what the nodes log about themselves
(``uavcan.protocol.debug.LogMessage``: errors, warnings and info, *Debug*
included, repeats folded) for the whole bus or one node. A read-only **ESC
telemetry** table lists ``uavcan.equipment.esc.Status`` per ESC index: RPM,
voltage, current, temperature, power and error count.

.. note::

   AP_Periph nodes usually report a raw value with no label, range or enum. The
   tab fills those in by name from AP_Periph's own parameter metadata; anything
   the node does report wins.

Firmware update over CAN
^^^^^^^^^^^^^^^^^^^^^^^^

The tab flashes AP_Periph node firmware over the CAN tunnel, with the app as
the file server. It sends ``uavcan.protocol.file.BeginFirmwareUpdate`` and
answers the node's ``file.Read`` requests with chunks of the image until the
node has read it all and reboots into it. Only one update runs at a time, and
every other action on the bus is locked while it runs. **Cancel update**
abandons it.

For an ``org.ardupilot.<board>`` node, arduconfigurator.com lists every
published AP_Periph build for that board under **Choose a build (n)…** and
downloads the one you pick. Elsewhere the card links the matching
``AP_Periph.bin`` on firmware.ardupilot.org to download and load as a local
``.bin``. The desktop app fetches it in-app. Confirm the brick-risk warning and
start. **Flash complete** shows when the node is back.

.. warning::

   Flashing the wrong or corrupt image can permanently disable a node. Keep the
   bus connected and powered for the whole transfer. A firmware update can also
   reset or corrupt a node's parameters. The tab re-reads them once the node is
   back. Re-check your settings (LED, GPS, compass, …) before flying.

.. note::

   PX4 and other vendor CAN devices are supported on the bus, but they get
   firmware from their own vendor. The AP_Periph build matching only applies
   to ArduPilot nodes.

Messages
~~~~~~~~

Every DroneCAN message stream on the bus, decoded live from the official DSDL:
``NodeStatus``, GNSS fixes, magnetic field, ESC status, battery info, and the
rest. Each stream shows its rate and the last decoded fields. Multi-frame transfers
are reassembled before decoding.

Frames
~~~~~~

Every raw frame on the bus, plain CAN and DroneCAN alike, in a scrolling
monitor. Filter by ID or **Name**, **Pause** / **Resume**, record a session, and open a
recording for playback. Multi-frame transfers can be grouped.

Plot
~~~~

Live charts of decoded fields and frame bytes, in the plot workspace shared
with the MAVLink Inspector (:doc:`logs-inspectors`). A vector field offers
**Plot all**. **Plotted** toggles a single field. Node messages appear as
markers.

Send
~~~~

Compose and send DroneCAN **messages**, **service requests** and **raw frames**
onto the bus, field by field from the DSDL.

See also :doc:`parameters` for editing flight-controller parameters and
:doc:`logs-inspectors` for the live MAVLink stream.

----

For DroneCAN concepts, node configuration, and bus wiring on the firmware side,
the ArduPilot wiki is canonical:
`DroneCAN setup <https://ardupilot.org/copter/docs/common-uavcan-setup-advanced.html>`__.
