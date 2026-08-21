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

.. note::

   **Phones and tablets cannot do serial.** Chrome for Android has no Web Serial
   API — it is not a permissions prompt you are missing, and no USB cable or OTG
   adapter changes it. On Android, either run the **WebSocket bridge** on a
   machine with the board plugged in and connect the tablet to it over the
   network, or use the desktop app on a laptop. (Android *does* have WebUSB, so
   a serial-over-WebUSB path is technically possible; this app does not
   implement one today.)

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
