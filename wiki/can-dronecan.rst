CAN & DroneCAN
==============

ArduConfigurator reaches the CAN bus from two places. The everyday **CAN** tab
manages DroneCAN nodes during setup. The **DroneCAN Inspector** is an
expert-only, Mission Planner-style tool for deeper node management: node health,
parameters, restart, and firmware update over CAN. Both ask the autopilot to
forward a CAN bus over the live MAVLink link, so you never have to switch the
flight controller into a dedicated SLCAN mode.

How the bus is reached
----------------------

The configurator uses MAVLink **CAN forwarding**. It sends
``MAV_CMD_CAN_FORWARD`` to the autopilot, which then tunnels raw ``CAN_FRAME``
messages for the chosen bus (CAN1 or CAN2) over the MAVLink connection you
already have. Normal telemetry keeps flowing on the link, so you do not drop the
vehicle connection to inspect the bus.

.. note::

   ArduPilot stops forwarding CAN frames about **5 seconds** after the last
   ``MAV_CMD_CAN_FORWARD`` request. The configurator re-arms forwarding about
   every 2 s while a bus is active, so the stream does not lapse mid-session. If
   a node goes quiet, check the bus first; the tunnel is rarely the cause.

Outbound DroneCAN service calls (parameter reads/writes, restart, firmware
file-serving) are sent as extended ``CAN_FRAME`` messages on the same tunnel.
The tunnel is best-effort, so the app retries lost requests, with bounded
budgets and watchdogs.

DroneCAN Inspector
------------------

The DroneCAN Inspector is an **Expert-mode** tool. Enable Expert mode to show it
(alongside the :doc:`logs-inspectors` MAVLink Inspector). Pick CAN1 or CAN2 and
**Start** the bus. The inspector forwards that bus and builds a live node
inventory.

Each node is found from its periodic ``uavcan.protocol.NodeStatus`` broadcasts
and named by an active ``uavcan.protocol.GetNodeInfo`` poll. The node table
shows, per node:

- **Node id** and **name** (e.g. ``org.ardupilot.Here4AP``)
- **Health:** ``ok`` / ``warning`` / ``error`` / ``critical``
- **Mode:** ``operational`` / ``initialization`` / ``maintenance`` /
  ``software_update`` / ``offline``
- **Uptime** and **last-seen** age

Bus stats (frames/s and node count, with an unhealthy-node count) sit above the
table. Expand a node to see its hardware/software version, the unique id, and
the per-node actions below.

.. note::

   The inspector also shows **ESC telemetry** (``uavcan.equipment.esc.Status``)
   per ESC index: RPM, voltage, current, temperature, power, and error count.
   This is observe-only.

Node parameters
---------------

Open the **Parameters** section under an expanded node to walk its parameter
table over ``uavcan.protocol.param.GetSet``. The section is collapsed by default
because opening it triggers a bus read. Opening it pulls the values, and
**Re-fetch** walks the table again from the start.

Edit a value and use **Apply & Save**. DroneCAN ``GetSet`` writes are RAM-only,
so once every write is acknowledged the app sends a
``uavcan.protocol.param.ExecuteOpcode`` SAVE. Without that SAVE, changes revert
at the node's next power cycle. After a successful save the node's parameters
are re-fetched automatically, so the grid shows what is stored.

.. note::

   AP_Periph nodes usually strip parameter metadata, so a node reports a raw
   value with no label, range, or enum. The configurator fills these in by
   matching each parameter **by name** against the curated flight-controller
   catalog: a friendly label, range hint, enum value labels, and a description.
   This is best-effort. A peripheral's range or enum *may* differ from the
   same-named flight-controller parameter, and node-reported values always win
   when present.

Restart node
~~~~~~~~~~~~

**Restart node** sends ``uavcan.protocol.RestartNode`` (behind a confirm step).
The node reboots, drops off the bus briefly, then reappears.

Firmware update over CAN
------------------------

The inspector can flash AP_Periph node firmware over the CAN tunnel, with the
GCS acting as the **file server**. It sends
``uavcan.protocol.file.BeginFirmwareUpdate`` and then answers the node's
``file.Read`` requests with chunks of the selected image until the node has read
the whole file and reboots into it. Only one update runs at a time, and every
other action on the bus is locked while it runs.

Select an ``AP_Periph.bin`` image, acknowledge the brick-risk confirmation, and
press **Update firmware**. For an ArduPilot ``org.ardupilot.<board>`` node the UI
links the matching ``AP_Periph.bin`` on ``firmware.ardupilot.org`` so you can
download the right build in one click.

.. warning::

   Flashing the wrong or corrupt image can permanently disable a node. Keep the
   bus connected and powered for the whole transfer. A firmware update can also
   reset or corrupt a node's parameters. Once the node is back, re-fetch its
   parameters and re-check your settings (LED, GPS, compass, …) before flying.

.. note::

   **Online firmware lookup is desktop-only.** A browser cannot fetch the
   ArduPilot firmware server directly (no CORS), so the browser build falls back
   to the manual download. PX4 and other vendor CAN devices are also supported
   on the bus, but they get firmware from their own vendor. The AP_Periph build
   matching only applies to ArduPilot nodes.

The normal CAN tab
------------------

The everyday **CAN** tab is separate from the Inspector. It uses the same
``MAV_CMD_CAN_FORWARD`` tunnel and the same node discovery and parameter
read/write/save code, but it is aimed at routine DroneCAN node setup. Firmware
update and ESC telemetry live in the Inspector. The CAN tab is available without
Expert mode.

.. tip::

   **"Enable the CAN bus?"** A common mistake is setting a peripheral's driver to
   DroneCAN without turning on the CAN interface. There is no error. The node is
   powered and on the wire, but invisible. The app watches for
   :param:`GPS_TYPE` or :param:`GPS_TYPE2` = 9 / 22 / 23 (DroneCAN, and the two
   moving-baseline variants), :param:`BATT_MONITOR` or :param:`BATT2_MONITOR`
   = 8, and :param:`FLOW_TYPE` = 6.

   When one of those is selected but CAN bus 1 is not enabled for DroneCAN, a
   one-click **Enable CAN bus & reboot** prompt writes ``CAN_P1_DRIVER = 1``
   (bind physical interface 1 to virtual driver 1) and ``CAN_D1_PROTOCOL = 1``
   (run DroneCAN on that driver) after an automatic backup. Both need a reboot;
   nodes appear after it. The prompt shows on the CAN tab for any of those
   triggers, and for the :param:`FLOW_TYPE` trigger also on the optical-flow
   section of the Peripherals surface (see
   :doc:`first-time-setup/peripherals-gimbal`).

See also :doc:`parameters` for editing flight-controller parameters and
:doc:`logs-inspectors` for the live MAVLink stream.

----

For DroneCAN concepts, node configuration, and bus wiring on the firmware side,
the ArduPilot wiki is canonical:
`DroneCAN setup <https://ardupilot.org/copter/docs/common-uavcan-setup-advanced.html>`__.
