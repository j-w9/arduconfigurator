Reference
=========

Practical references for using the configurator: how it is driven, what to do
when something does not connect, what hardware it supports, and a short glossary
of the terms used throughout this wiki.

.. contents:: On this page
   :local:
   :depth: 1

Keyboard shortcuts
------------------

Configuration in ArduConfigurator is **mouse-driven** — there are no global
keyboard shortcuts for navigation or editing. The one keyboard affordance is
**Escape**, which closes transient dialogs and overlays (the motor-reorder
dialog and the board-media lightbox).

Troubleshooting
---------------

**No RC telemetry / the Receiver monitor shows nothing.**
The receiver isn't being seen by the flight controller yet. Check that the
serial port the receiver is wired to has its protocol set to RCIN (serial
protocol **23**) — see :doc:`first-time-setup/ports-serial` — and that the
receiver is bound to your transmitter. The Receiver tab has an in-app bind
button for ELRS/CRSF; see :doc:`first-time-setup/receiver`.

**Wrong or silent serial port at connect.**
Flight controllers typically expose **two** USB serial ports, and only one
carries MAVLink. The app auto-detects the MAVLink port by probing for
heartbeats, but if you connected to the wrong one (or nothing appears), simply
reconnect and let it re-detect, or pick the other port.

**The browser won't offer a serial port.**
Web Serial is a **Chromium-only** API. Use Chrome, Edge, or another
Chromium-based browser; Firefox and Safari do not implement it. The desktop
shell uses a native serial transport instead and is not subject to this limit.
See :doc:`getting-connected`.

**A change didn't take effect.**
Some parameters only apply after a reboot. When a change needs one, the app
surfaces a reboot prompt — reboot the flight controller (or power-cycle it) and
re-check the value. See :doc:`parameters`.

Supported hardware
------------------

ArduConfigurator connects to, configures, and can flash **ArduPilot
autopilots** — the same boards ArduPilot firmware targets. Connect over USB
(Web Serial in the browser, or native serial in the desktop shell).

The validated, real-hardware-exercised path is **ArduCopter** — it is the trust
anchor the project guarantees against, so Copter workflows are the most
thoroughly exercised. Plane, Rover, and Sub are increasingly supported, but
Copter is where the deepest testing lives. For the authoritative,
continuously-updated list of supported boards, the ArduPilot wiki is canonical.

Glossary
--------

ArduPilot
   The open-source autopilot firmware (ArduCopter, ArduPlane, Rover, Sub) that
   runs on the flight controller. ``ardupilot.org`` is its canonical wiki.

GCS
   *Ground Control Station* — software that talks to the vehicle over MAVLink.
   ArduConfigurator is a setup- and configuration-first GCS, not a general
   mission/flight GCS.

MAVLink
   The lightweight serial protocol used to exchange messages and commands
   between a vehicle and a ground station. ArduConfigurator speaks MAVLink v2.

DroneCAN
   A message-based protocol (formerly UAVCAN) for peripherals — GPS, compass,
   ESCs, power monitors — over a CAN bus. See :doc:`can-dronecan`.

CRSF / ELRS
   *Crossfire* and *ExpressLRS* — modern RC link protocols. The flight
   controller relays binding and link data over the CRSF serial link; see
   :doc:`first-time-setup/receiver`.

RSSI
   *Received Signal Strength Indication* — RC link-quality reporting, surfaced
   as a percentage in the Receiver tab.

DShot
   A digital ESC protocol. *Bidirectional DShot* additionally returns ESC RPM
   telemetry to the flight controller.

MAVFTP
   MAVLink's file-transfer extension, used here to list and download onboard
   logs and to read system files. See :doc:`logs-inspectors`.

RTL
   *Return To Launch* — an ArduPilot flight mode that flies the vehicle back to
   its launch point.

SITL
   *Software In The Loop* — a simulated ArduPilot vehicle with no hardware,
   used for testing and the in-app demo.

----

For firmware concepts, flight modes, and tuning theory, the
`ArduPilot documentation <https://ardupilot.org/>`__ remains the canonical
reference.
