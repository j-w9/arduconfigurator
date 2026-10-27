Reference
=========

This page covers how the app is driven, what to do when something does not
connect, what hardware it supports, and a short glossary of the terms used in
this wiki.

Keyboard shortcuts
------------------

ArduConfigurator is **mouse-driven**. There are no global keyboard shortcuts
for navigation or editing. The only key with a function is **Escape**, which
closes transient dialogs and overlays (the motor-reorder dialog and the
board-media lightbox).

Troubleshooting
---------------

**No RC telemetry / the Receiver monitor shows nothing.**
The receiver isn't being seen by the flight controller yet. Check that the
serial port the receiver is wired to has its protocol set to RCIN (serial
protocol **23**, see :doc:`first-time-setup/ports-serial`), and that the
receiver is bound to your transmitter. The Receiver tab has an in-app bind
button for ELRS/CRSF (see :doc:`first-time-setup/receiver`).

**Wrong or silent serial port at connect.**
Flight controllers usually expose **two** USB serial ports, and only one
carries MAVLink. The app finds the MAVLink port by probing for heartbeats. If
you connected to the wrong one (or nothing appears), reconnect and let it
detect again, or pick the other port.

**The browser won't offer a serial port.**
Web Serial is a **Chromium-only** API. Use Chrome, Edge or another
Chromium-based browser. Firefox and Safari do not implement it. The desktop
shell uses native serial, so this limit does not apply there.
See :doc:`getting-connected`.

**A change didn't take effect.**
Some parameters only apply after a reboot. When a change needs one, the app
shows a reboot prompt. Reboot the flight controller (or power-cycle it) and
check the value again. See :doc:`parameters`.

**The link dropped and I saw a "link lost" banner.**
You have not lost data. If the connection drops, including a board that
watchdog-resets partway through the parameter sync, the app keeps the
parameters it already read behind a **link lost** banner. They are marked as no
longer live, and writes are blocked while disconnected. On reconnect the
parameter download **resumes from where it stopped**, so even a board that keeps
resetting reaches a complete table. See
:doc:`getting-connected`.

Supported hardware
------------------

ArduConfigurator connects to, configures and can flash **ArduPilot
autopilots**: the same boards ArduPilot firmware targets. Connect over USB
(Web Serial in the browser, or native serial in the desktop shell).

**ArduCopter** is the path validated on real hardware, and Copter workflows are
the most tested. Plane, Rover and Sub are supported, with less testing. For the
current list of supported boards, see the ArduPilot wiki.

Glossary
--------

ArduPilot
   The open-source autopilot firmware (ArduCopter, ArduPlane, Rover, Sub) that
   runs on the flight controller. ``ardupilot.org`` is its canonical wiki.

GCS
   *Ground Control Station*: software that talks to the vehicle over MAVLink.
   ArduConfigurator is a GCS for setup and configuration. It is not a general
   mission/flight GCS.

MAVLink
   The lightweight serial protocol used to exchange messages and commands
   between a vehicle and a ground station. ArduConfigurator speaks MAVLink v2.

DroneCAN
   A message-based protocol (formerly UAVCAN) for peripherals such as GPS,
   compass, ESCs and power monitors over a CAN bus. See :doc:`can-dronecan`.

CRSF / ELRS
   *Crossfire* and *ExpressLRS*: modern RC link protocols. The flight
   controller relays binding and link data over the CRSF serial link; see
   :doc:`first-time-setup/receiver`.

RSSI
   *Received Signal Strength Indication*: RC link-quality reporting, shown as
   a percentage on the Receiver tab.

DShot
   A digital ESC protocol. *Bidirectional DShot* additionally returns ESC RPM
   telemetry to the flight controller.

MAVFTP
   MAVLink's file-transfer extension, used here to list and download onboard
   logs and to read system files. See :doc:`logs-inspectors`.

RTL
   *Return To Launch*: an ArduPilot flight mode that flies the vehicle back to
   its launch point.

SITL
   *Software In The Loop*: a simulated ArduPilot vehicle with no hardware,
   used for testing and the in-app demo.

----

For firmware concepts, flight modes and tuning theory, the
`ArduPilot documentation <https://ardupilot.org/>`__ is the canonical
reference.
