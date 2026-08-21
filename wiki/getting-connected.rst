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
   Brave, Opera) over a secure (HTTPS) origin, and only on the **desktop**:
   Chrome 89+ on ChromeOS, Linux, macOS and Windows. If the Serial / USB option
   is greyed out as *(n/a)*, this browser does not implement it.

USB (WebUSB) — Android
----------------------

Chrome on Android **does** have a Web Serial API now (M148/149), but that does
not mean it can reach a board on a cable: USB serial there rides the new Android
Serial API, which Chromium's own announcement says arrives *"in 2026Q2 on a
limited set of devices"*. Everywhere else the picker opens with nothing in it —
the *"Failed to execute 'requestPort' on 'Serial': No port selected by user"* a
Galaxy reports with a flight controller plugged in.

**WebUSB** is the route that works today. Android ships no CDC-ACM driver, so
nothing claims the board's serial interface before the browser can, and the page
drives the port itself. Both options stay available on Android — a device with
the new Android Serial API can use plain Serial — but **USB (WebUSB)** is the
default there. On the desktop it is not offered at all: the operating system
owns that interface and claiming it fails.

Pick **USB (WebUSB)**, tap **Connect**, and choose the flight controller from
the browser's device list. The picker is filtered to ArduPilot's USB identifiers
(``1209:5740`` for boards with two USB serial ports, ``1209:5741`` for one), so
it lists the board rather than everything plugged in. Chrome remembers the grant
per site, so later sessions reconnect without asking again.

The link claims the **first** CDC interface, which on an ArduPilot board is
MAVLink (the second is SLCAN). If the board answers but no heartbeat arrives,
give it a few seconds to finish booting and reconnect.

.. note::

   Some Android builds *do* ship a driver that claims CDC-ACM. Where that
   happens the browser cannot take the interface and the connect fails with a
   "busy" message naming the cause. There is no workaround from a web page:
   fall back to the **WebSocket bridge** from a machine with the board attached,
   or the desktop app.

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

If the link drops mid-sync — for example a board that watchdog-resets partway
through the parameter download — the configurator keeps the parameters it
already read behind a **"link lost"** banner (they are marked as no longer
live, and nothing can be written while disconnected). On reconnect the download
**resumes from where it stopped** rather than restarting from zero, and it keeps
retrying while the board is coming back, so a resetting board still ends up with
a complete parameter table. A dropped link is not data loss.
