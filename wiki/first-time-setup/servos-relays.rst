Servos and Relays
=================

The **Servos** tab assigns a function to each auxiliary output, and the
**Relays** sub-tab configures the GPIO-style relay outputs used for switched
payloads. Both live under the **Outputs** panel's task strip alongside motor
setup, ESC protocol, and peripherals. Notify devices — external LEDs and
buzzers — are configured nearby in the Outputs peripherals card.

.. contents:: On this page
   :local:
   :depth: 1

Servo output functions
-----------------------

The **Servos** task (the *servo mapping* tab) shows a table of every output
channel the flight controller reports, with columns **Channel · Function · Min ·
Trim · Max · Rev · Kind**. The *Function* cell assigns ``SERVOn_FUNCTION`` —
what that physical output drives. ArduPilot offers a long list; common choices
include *Disabled*, *RCPassThru*, motor outputs (*Motor 1*…*Motor 12*+), control
surfaces (*Aileron*, *Elevator*, *Rudder*, *Elevon Left/Right*, *VTail
Left/Right*), gimbal axes (*Mount Pitch/Roll/Yaw*), *Camera Trigger*, *Gripper*,
and the *NeoPixel 1*–*NeoPixel 4* LED-strip functions.

Each channel also exposes its PWM endpoints and direction:

- ``SERVOn_MIN`` / ``SERVOn_TRIM`` / ``SERVOn_MAX`` — the output range and centre
  in microseconds (800–2200 µs).
- ``SERVOn_REVERSED`` — a *Rev* checkbox that flips the output direction.

The *Kind* badge classifies each output (Motor, Control Surface, RC Pass-through,
Peripheral, Disabled) so you can see at a glance what the frame is using. Edits
stage as drafts; **Apply servo mapping** commits them and **Revert** discards
them.

.. warning::

   Reassigning ``SERVOn_FUNCTION`` on an output wired to an ESC can spin a
   motor. Keep the props off whenever you change output functions, and re-check
   the motor mapping on the :doc:`outputs-motors` tab afterwards.

Notify devices (LED and buzzer)
-------------------------------

External LEDs and buzzers are driven by ArduPilot's *notify* subsystem rather
than by an output function, so they live in the **LED & buzzer notifications**
card on the Outputs surface (not the servo table). The two driver parameters are
bitmasks:

- ``NTF_LED_TYPES`` — which LED drivers are active (*Built-in LED*, *NeoPixel*,
  *ProfiLED*, *DShot*, *DroneCAN*, *Scripting*, …).
- ``NTF_BUZZ_TYPES`` — which buzzer drivers are active (*Built-in Buzzer*,
  *DShot*, *DroneCAN*).

You set these by **clicking the driver chips** — each chip toggles one bit and
highlights when on; there is no separate checkbox. Supporting parameters include
``NTF_LED_BRIGHT`` (Off/Low/Medium/High), ``NTF_LED_LEN`` (number of LEDs in a
strip), ``NTF_LED_OVERRIDE`` (the LED source), and ``NTF_BUZZ_VOLUME``.

.. note::

   For an addressable LED strip to light up, an output must also carry a
   *NeoPixel* function (``SERVOn_FUNCTION`` 120–123). The notifications card
   detects and lists any such configured outputs and prompts you to assign one
   if none is set.

Relays
------

The **Relays** sub-tab configures up to six relay outputs as a grid of per-relay
cards. Each relay has:

- ``RELAYn_FUNCTION`` — what the relay is for: *None*, *Relay* (manual on/off),
  *Ignition*, *Parachute*, *Camera*, brushed-motor-reverse functions, *ICE
  Starter*, or a *DroneCAN Hardpoint*.
- ``RELAYn_PIN`` — the autopilot GPIO pin the relay drives (set to -1 to
  disable).
- ``RELAYn_DEFAULT`` — the power-on state (*Off* / *On* / *NoChange*), shown when
  the function is the plain *Relay* type.
- ``RELAYn_INVERTED`` — *Normal* or *Inverted* pin polarity.

.. note::

   ``RELAYn_FUNCTION``, ``RELAYn_PIN``, and ``RELAYn_DEFAULT`` are applied when
   the flight controller boots — the pin is configured and the default state set
   at start-up — so a change is **reboot-required**: the app prompts you to
   reboot before it takes effect. ``RELAYn_INVERTED`` applies live.

Enum fields render as selectable chips and the pin as a number field; the same
staged **Apply relay changes** / **Revert** toolbar applies. Only relay
instances the flight controller actually reports are shown.

.. note::

   ``RELAYn_PIN`` must match a pin your autopilot exposes as a GPIO. The correct
   pin number depends on the board and which functions are enabled on the
   ``BRD_*`` GPIO/PWM parameters — consult your board's documentation.

See also the ArduPilot wiki: `Relay Switch
<https://ardupilot.org/copter/docs/common-relay.html>`_ and the
`Servo / Output function list
<https://ardupilot.org/copter/docs/common-rcoutput-mapping.html>`_.
