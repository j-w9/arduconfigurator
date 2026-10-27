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
3. The browser shows a port-picker dialog. Select the flight controller's port
   and confirm.

.. note::

   Most ArduPilot boards expose **two USB serial ports**: one carries MAVLink,
   the other is SLCAN/console. The app probes for heartbeats to find the MAVLink
   port. If the first port is silent, it tries the other. If you land on the
   wrong one, disconnect and reconnect.

.. warning::

   Web Serial needs a Chromium-based browser (Chrome, Edge, Brave, Opera), an
   HTTPS origin and a desktop OS: Chrome 89+ on ChromeOS, Linux, macOS and
   Windows. If the Serial / USB option is greyed out as *(n/a)*, this browser
   does not have it.

USB (WebUSB) — Android
----------------------

Chrome on Android has Web Serial (M148/149), but USB serial there rides the new
Android Serial API, which Chromium says arrives *"in 2026Q2 on a limited set of
devices"*. On every other device the picker opens empty: a Galaxy with a board
plugged in reports *"Failed to execute 'requestPort' on 'Serial': No port
selected by user"*.

**WebUSB** works today. Android ships no CDC-ACM driver, so nothing claims the
board's serial interface before the browser does, and the page drives the port
itself. Both options stay on Android (a device with the Android Serial API can
use plain Serial), but **USB (WebUSB)** is the default there. On the desktop it
is not offered: the operating system owns that interface and claiming it fails.

Pick **USB (WebUSB)**, tap **Connect**, and choose the flight controller from
the browser's device list. The picker is filtered to ArduPilot's USB identifiers
(``1209:5740`` for boards with two USB serial ports, ``1209:5741`` for one), so
it lists only the board. Chrome remembers the grant per site, so later sessions
reconnect without asking again.

The link claims the **first** CDC interface, which on an ArduPilot board is
MAVLink (the second is SLCAN). If the board answers but no heartbeat arrives,
give it a few seconds to finish booting and reconnect.

.. note::

   Some Android builds ship a driver that claims CDC-ACM. On those, the browser
   cannot take the interface and the connect fails with a "busy" message naming
   the cause. A web page cannot work around this. Use the **WebSocket bridge**
   from a machine with the board attached, or the desktop app.

WebSocket bridge
----------------

Connects to a flight controller through the local **MAVLink-over-WebSocket
bridge**: SITL, a replayed session, or a serial/demo source served from the
desktop tooling. Enter the bridge URL (default ``ws://localhost:8765``) and
connect.

Demo mode
---------

Loads the built-in mock vehicle. No hardware is needed, and you can explore
every part of the app. See :doc:`introduction`.

After connecting
----------------

Once connected, the header shows the vehicle type, firmware version and a live
link indicator, and the parameter table syncs. From here, go to
:doc:`guided-setup` for a fresh vehicle, or open any tab.

When nothing ever answers
~~~~~~~~~~~~~~~~~~~~~~~~~

If the port opens and **no heartbeat ever arrives**, check the baud rate and
that you picked the MAVLink port. Most controllers expose two USB serial
interfaces and only one of them speaks MAVLink. A booting board can also take
several seconds to send its first heartbeat.

A board running **Betaflight** never sends one, because it does not speak
MAVLink. The app does not try to detect this, since silence has many ordinary
causes. If you know the board runs Betaflight, open the Betaflight sub-tab on
:doc:`first-time-setup/flashing-firmware`. It reads the board over MSP and puts
it into DFU.

When it answers, but not as ArduPilot
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A board running **PX4** sends heartbeats this app cannot use, and says so:
**"PX4 is not currently supported."** The board is connected and talking, but
the app cannot configure it. To run ArduPilot, flash it from the Flash tab and
reconnect.

Only PX4 is named. Any other autopilot type is reported by its MAVLink id.

If the link drops mid-sync (for example, a board that watchdog-resets during
the parameter download), the app keeps the parameters it already read behind a
**"link lost"** banner. They are marked as no longer live, and nothing can be
written while disconnected. On reconnect the download **resumes from where it
stopped**. It keeps retrying while the board comes back, so a resetting board
still ends up with a complete parameter table. You do not lose data when the
link drops.
