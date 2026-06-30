Introduction to ArduConfigurator
================================

ArduConfigurator is a **browser-first configurator for ArduPilot**. It connects
to your flight controller over Web Serial directly from a Chromium-based browser
— no install required — and is built setup- and configuration-first, in the same
spirit as the Betaflight Configurator, but for ArduPilot.

.. note::

   ArduConfigurator is aimed first at **ArduCopter FPV** workflows. ArduPlane,
   ArduRover, and ArduSub are supported and growing, but Copter is the validated,
   hardware-exercised path.

What you can do with it
-----------------------

- **Connect** to a flight controller over USB (Web Serial), a WebSocket bridge,
  or explore everything in **demo mode** with no hardware.
- **Flash firmware** — ArduPilot ``.apj`` over the serial bootloader, or a
  ``.hex`` over WebUSB DFU.
- **Run a guided setup** that walks you through the first-time configuration in
  order, verifying each step against the live vehicle.
- **Configure every subsystem** through product-shaped tabs — receiver, outputs
  and motors, power, failsafe, flight modes, sensors, OSD/VTX, peripherals.
- **Tune** rate and angle controllers.
- **Edit raw parameters** (Expert mode) with import/export, backups, presets,
  and snapshots.
- **Inspect** the MAVLink stream and DroneCAN bus, and download logs over MAVFTP.

Browser support
---------------

ArduConfigurator uses the **Web Serial** and **WebUSB** APIs, which are available
in Chromium-based browsers (Chrome, Edge, Brave, Opera). Firefox and Safari do
not currently implement Web Serial, so live connections are not available there —
demo mode still works everywhere.

A desktop application (Electron) is also available; it wraps the same app with a
native serial transport and is handy when a browser's Web Serial support is
restricted.

Demo mode
---------

Selecting **Demo** as the connection source loads a built-in mock vehicle. The
entire interface is explorable — tabs, the guided setup, the inspectors — with no
flight controller attached. It is the fastest way to get a feel for the tool, and
it is how the screenshots in this wiki are produced.

Next steps
----------

- :doc:`getting-connected` — pick a connection method and connect.
- :doc:`guided-setup` — the recommended path for a fresh vehicle.
