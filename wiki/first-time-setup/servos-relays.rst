Servos
======

The **Servos** tab assigns a function to each auxiliary output. It is a single
page with no sub-tabs: the output map, followed by the metadata-backed output
settings that extend it.

.. note::

   Relays, the notification LEDs and buzzer, the gimbal and the
   rangefinder/optical-flow settings are on :doc:`peripherals-gimbal`, with the
   other hardware wired to the board. Relays are documented below for
   reference, but you configure them on the Peripherals tab.

Servo output functions
-----------------------

The servo mapping table shows a row for every output
channel the flight controller reports, with columns **Channel · Function · Min ·
Trim · Max · Live · Rev · Kind**. The *Function* cell sets ``SERVOn_FUNCTION``,
which is what that physical output drives. ArduPilot offers a long list. Common
choices include *Disabled*, *RCPassThru*, motor outputs (*Motor 1*…*Motor 12*+), control
surfaces (*Aileron*, *Elevator*, *Rudder*, *Elevon Left/Right*, *VTail
Left/Right*), gimbal axes (*Mount Pitch/Roll/Yaw*), *Camera Trigger*, *Gripper*,
the *Script 1*–*Script 16* outputs a Lua script drives, and the *NeoPixel
1*–*NeoPixel 4* LED-strip functions.

Each channel also exposes its PWM endpoints and direction:

- ``SERVOn_MIN`` / ``SERVOn_TRIM`` / ``SERVOn_MAX``: the output range and centre
  in microseconds (800–2200 µs).
- ``SERVOn_REVERSED``: a *Rev* checkbox that flips the output direction.

Live output values
------------------

The *Live* column shows the value the flight controller is driving each
output to, in microseconds, updated about ten times a second. A bar beside the
number shows where that value sits between the channel's own ``SERVOn_MIN`` and
``SERVOn_MAX``, and turns amber when the output is at or past one of them.

``SERVOn_FUNCTION`` says what an output is *for*, and the range fields say what
it is *allowed* to do. The *Live* column shows what it is doing right now. When
a surface will not move and the configuration looks correct, check here. Usually
the output is either not driven at all, or driven hard into an endpoint.

An output reading **idle** means the firmware is not driving that channel at
all. It is not a low PWM value. Outputs a board does not use show **idle**
instead of a number.

.. note::

   The readout needs the vehicle to be streaming ``SERVO_OUTPUT_RAW``. The app
   requests it on connect, so it appears on its own. A dash means nothing has
   arrived for that channel yet.

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

ArduPilot's *notify* subsystem drives external LEDs and buzzers. They do not use
an output function, so they are set in the **LED & buzzer notifications** card
on **Peripherals → LEDs & Buzzer**, not in the servo table. The two driver parameters are
bitmasks:

- ``NTF_LED_TYPES``: which LED drivers are active (*Built-in LED*, *NeoPixel*,
  *ProfiLED*, *DShot*, *DroneCAN*, *Scripting*, …).
- ``NTF_BUZZ_TYPES``: which buzzer drivers are active (*Built-in Buzzer*,
  *DShot*, *DroneCAN*).

You set these by **clicking the driver chips**. Each chip toggles one bit and
highlights when on. There is no separate checkbox. Supporting parameters include
``NTF_LED_BRIGHT`` (Off/Low/Medium/High), ``NTF_LED_LEN`` (number of LEDs in a
strip), ``NTF_LED_OVERRIDE`` (the LED source), and ``NTF_BUZZ_VOLUME``.

.. note::

   For an addressable LED strip to light up, an output must also carry a
   *NeoPixel* function (``SERVOn_FUNCTION`` 120–123). The notifications card on
   :doc:`peripherals-gimbal` lists any outputs set this way, and prompts you
   to assign one if none is set.

Relays
------

The **Relays** section (on :doc:`peripherals-gimbal`) configures up to six relay
outputs as a grid of per-relay cards. Each relay has:

- ``RELAYn_FUNCTION``: what the relay is for: *None*, *Relay* (manual on/off),
  *Ignition*, *Parachute*, *Camera*, brushed-motor-reverse functions, *ICE
  Starter*, or a *DroneCAN Hardpoint*.
- ``RELAYn_PIN``: the autopilot GPIO pin the relay drives (set to -1 to
  disable).
- ``RELAYn_DEFAULT``: the power-on state (*Off* / *On* / *NoChange*), shown when
  the function is the plain *Relay* type.
- ``RELAYn_INVERTED``: *Normal* or *Inverted* pin polarity.

.. note::

   ``RELAYn_FUNCTION``, ``RELAYn_PIN`` and ``RELAYn_DEFAULT`` are applied when
   the flight controller boots, which is when the pin is configured and the
   default state set. A change to them is **reboot-required**, and the app
   prompts you to reboot before it takes effect. ``RELAYn_INVERTED`` applies live.

Enum fields show as selectable chips and the pin as a number field. Changes are
staged and committed with the **Apply relay changes** / **Revert** toolbar.
Only relay instances the flight controller reports are shown.

.. note::

   ``RELAYn_PIN`` must match a pin your autopilot exposes as a GPIO. The correct
   pin number depends on the board and which functions are enabled on the
   ``BRD_*`` GPIO/PWM parameters. Check your board's documentation.

See also the ArduPilot wiki: `Relay Switch
<https://ardupilot.org/copter/docs/common-relay.html>`_ and the
`Servo / Output function list
<https://ardupilot.org/copter/docs/common-rcoutput-mapping.html>`_.
