CAN & DroneCAN
==============

ArduConfigurator talks to the CAN bus two ways. The everyday **CAN** tab manages
DroneCAN nodes during setup; the **DroneCAN Inspector** is an expert-only,
Mission Planner-style surface for deeper node management — node health,
parameters, restart, and firmware update over CAN. Both reach the bus the same
way: they ask the autopilot to forward a CAN bus over the live MAVLink link, so
you never have to switch the flight controller into a dedicated SLCAN mode.

.. contents:: On this page
   :local:
   :depth: 1

How the bus is reached
----------------------

Rather than SLCAN, the configurator uses MAVLink **CAN forwarding**. It sends
``MAV_CMD_CAN_FORWARD`` to the autopilot, which then tunnels raw ``CAN_FRAME``
messages for the chosen bus (CAN1 or CAN2) over the same MAVLink connection you
are already using. The advantage is that normal telemetry keeps flowing on the
link — you do not drop the vehicle connection to inspect the bus.

.. note::

   ArduPilot stops forwarding CAN frames roughly **5 seconds** after the last
   ``MAV_CMD_CAN_FORWARD`` request. The configurator re-arms forwarding well
   inside that window (about every 2 s) for as long as a bus is active, so the
   stream does not lapse mid-session. If a node goes quiet, it is almost always
   the bus itself, not the tunnel.

Outbound DroneCAN service calls (parameter reads/writes, restart, firmware
file-serving) are sent as extended ``CAN_FRAME`` messages on the same tunnel.
Because the tunnel is best-effort, the app retries lost requests with bounded
budgets and watchdogs rather than assuming a single send arrived.

DroneCAN Inspector
------------------

The DroneCAN Inspector is an **Expert-mode** tool — enable Expert mode to reveal
it (alongside the :doc:`logs-inspectors` MAVLink Inspector). Pick CAN1 or CAN2
and **Start** the bus; the inspector forwards that bus and builds a live node
inventory.

Each node is discovered from its periodic ``uavcan.protocol.NodeStatus``
broadcasts and named by an active ``uavcan.protocol.GetNodeInfo`` poll. The node
table shows, per node:

- **Node id** and **name** (e.g. ``org.ardupilot.Here4AP``)
- **Health** — ``ok`` / ``warning`` / ``error`` / ``critical``
- **Mode** — ``operational`` / ``initialization`` / ``maintenance`` /
  ``software_update`` / ``offline``
- **Uptime** and **last-seen** age

Bus stats (frames/s and node count, with an unhealthy-node count) sit above the
table. Expanding a node reveals its hardware/software version, the unique id, and
the per-node actions below.

.. note::

   The inspector also surfaces **ESC telemetry** (``uavcan.equipment.esc.Status``)
   per ESC index — RPM, voltage, current, temperature, power, and error count.
   This is observe-only.

Node parameters
---------------

Open the **Parameters** section under an expanded node to walk its parameter
table over ``uavcan.protocol.param.GetSet`` (the walk is collapsed by default
because it triggers a bus read; opening it pulls the values, and **Re-fetch**
re-walks from the start).

Edit a value and use **Apply & Save**. DroneCAN ``GetSet`` writes are RAM-only,
so the app follows the writes with a ``uavcan.protocol.param.ExecuteOpcode``
SAVE once every write is acknowledged — without that SAVE, changes revert on the
node's next power cycle. After a successful save the node's parameters are
re-fetched automatically so the grid reflects what is actually stored.

.. note::

   AP_Periph nodes usually strip parameter metadata, so a node reports a raw
   value with no label, range, or enum. The configurator enriches the grid by
   matching each parameter **by name** against the curated flight-controller
   catalog, filling in a friendly label, range hint, enum value labels, and a
   description. This is best-effort — a peripheral's range or enum *may* differ
   from the same-named flight-controller parameter, and node-reported values
   always win when present.

Restart node
~~~~~~~~~~~~

**Restart node** sends ``uavcan.protocol.RestartNode`` (behind a confirm step).
The node reboots and drops off the bus briefly, then reappears.

Firmware update over CAN
------------------------

The inspector can flash AP_Periph node firmware over the CAN tunnel, with the
GCS acting as the **file server**. It sends
``uavcan.protocol.file.BeginFirmwareUpdate`` and then answers the node's
``file.Read`` requests with chunks of the selected image until the node has read
the whole file and reboots into it. Only one update runs at a time, and every
other action on the bus is locked while it runs.

Select an ``AP_Periph.bin`` image, acknowledge the brick-risk confirmation, and
**Update firmware**. For an ArduPilot ``org.ardupilot.<board>`` node the UI
deep-links the matching ``AP_Periph.bin`` on ``firmware.ardupilot.org`` so you
can download the right build in one click.

.. warning::

   Flashing the wrong or corrupt image can permanently disable a node. Keep the
   bus connected and powered for the whole transfer. A firmware update can also
   reset or corrupt a node's parameters — once the node is back, re-fetch its
   parameters and re-check your settings (LED, GPS, compass, …) before flying.

.. note::

   **Online firmware lookup is desktop-only.** A browser cannot fetch the
   ArduPilot firmware server directly (no CORS), so the browser build degrades to
   the manual-download path. PX4 and other vendor CAN devices are also supported
   on the bus, but they get firmware from their own vendor — the AP_Periph build
   matching only applies to ArduPilot nodes.

The normal CAN tab
------------------

The everyday **CAN** tab is a separate surface from the Inspector. It uses the
same ``MAV_CMD_CAN_FORWARD`` tunnel and the same node-discovery and
parameter read/write/save plumbing, but is aimed at routine DroneCAN node setup
rather than the full expert toolkit (firmware update and ESC telemetry live in
the Inspector). It is available without Expert mode.

See also :doc:`parameters` for editing flight-controller parameters and
:doc:`logs-inspectors` for the live MAVLink stream.

----

For DroneCAN concepts, node configuration, and bus wiring on the firmware side,
the ArduPilot wiki is canonical:
`DroneCAN setup <https://ardupilot.org/copter/docs/common-uavcan-setup-advanced.html>`__.
