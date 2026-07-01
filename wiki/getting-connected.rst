Getting Connected
=================

ArduConfigurator talks to your flight controller through a **connection source**
chosen on the landing screen. Pick the one that matches your setup, then click
**Connect**.

Serial / USB (Web Serial)
-------------------------

The default for a flight controller plugged into your computer over USB.

1. Plug the flight controller into a USB port.
2. Choose **Serial / USB** as the source and click **Connect**.
3. The browser shows a port-picker dialog — select the flight controller's port
   and confirm.

.. note::

   Most ArduPilot boards expose **two USB serial ports** — one carries MAVLink,
   the other is a SLCAN/console port. ArduConfigurator probes for heartbeats to
   pick the MAVLink port automatically; if the first pick is silent it will try
   the other. If you ever land on the wrong one, disconnect and reconnect.

.. warning::

   Web Serial is only available in **Chromium-based browsers** (Chrome, Edge,
   Brave, Opera) over a secure (HTTPS) origin. If you don't see the Serial / USB
   option, you're likely in a browser that doesn't implement Web Serial — use the
   desktop app or demo mode.

WebSocket bridge
----------------

Connects to a flight controller exposed by the local **MAVLink-over-WebSocket
bridge** — useful for SITL, a replayed session, or a serial/demo source served
from the desktop tooling. Enter the bridge URL (default
``ws://localhost:8765``) and connect.

Demo mode
---------

Loads the built-in mock vehicle — no hardware required. Everything in the app is
explorable. See :doc:`introduction`.

After connecting
----------------

Once connected, the header shows the vehicle type, firmware version, and a live
link indicator, and the parameter table syncs. From here, head to
:doc:`guided-setup` for a fresh vehicle, or jump straight to any tab.
