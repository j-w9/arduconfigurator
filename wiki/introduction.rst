Introduction to ArduConfigurator
================================

ArduConfigurator is a **browser-first configurator for ArduPilot**. It connects
to your flight controller over Web Serial from a Chromium-based browser, with
nothing to install. Like Betaflight Configurator, it is built for setup and
configuration.

.. note::

   ArduConfigurator is aimed first at **ArduCopter FPV** workflows. ArduPlane,
   ArduRover and ArduSub are supported, but Copter is the validated path,
   exercised on real hardware.

What you can do with it
-----------------------

- **Connect** to a flight controller over USB (Web Serial), a WebSocket bridge,
  or explore everything in **demo mode** with no hardware.
- **Flash firmware**: ArduPilot ``.apj`` over the serial bootloader, or a
  ``.hex`` over WebUSB DFU.
- **Run a guided setup** that takes you through first-time configuration in
  order, checking each step against the live vehicle.
- **Configure each subsystem** on its own tab: receiver, outputs and motors,
  power, failsafe, flight modes, sensors, OSD/VTX, peripherals.
- **Tune** rate and angle controllers.
- **Edit raw parameters** (Expert mode) with import/export, backups, presets,
  and snapshots.
- **Inspect** the MAVLink stream and DroneCAN bus, and download logs over MAVFTP.

Browser support
---------------

Live connections use the **Web Serial** and **WebUSB** APIs, which Chromium-based
browsers have (Chrome, Edge, Brave, Opera). Firefox and Safari do not, so they
can only run demo mode.

A desktop app (Electron) wraps the same app with native serial, for machines
where Web Serial is restricted.

Demo mode
---------

**Demo (Copter)** or **Demo (Plane)** as the connection source loads a built-in
mock vehicle. Every tab, the guided setup and the inspectors work with no flight
controller attached. The screenshots in this wiki come from it.

Finding your way around
-----------------------

The tabs sit in a rail down the left, in the order a build gets flying:
**Status & Info**, Setup (with Calibration), Ports, Receiver, Motors, Failsafe,
Tuning, then OSD & VTX, Servos, Peripherals, Presets, Snapshots, Logs, CAN,
Files, Flash. A **Find a setting** box at the top of the rail searches tabs, cards and
parameters by name and opens the match.

**Expert mode** (the *Enable Expert Mode* switch in the header, behind ``···``
on a phone) adds the raw :doc:`Parameters <parameters>` editor,
the :doc:`MAVLink Inspector <logs-inspectors>`, :doc:`Networking <networking>`
and :doc:`Lua Scripts <lua>` when the firmware supports them, and the
:doc:`guided-setup` tab. Everything else is available in both modes.

Next steps
----------

- :doc:`getting-connected`: pick a connection method and connect.
- :doc:`guided-setup`: the recommended path for a fresh vehicle.
