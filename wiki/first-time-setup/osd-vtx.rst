OSD and VTX
===========

The **OSD** tab lays out the on-screen-display overlay drawn on your FPV video,
and the **VTX** tab configures the video transmitter. Both use the familiar
staged-draft model: edits accumulate, then **Save** writes them and **Revert**
discards them.

OSD layout
----------

ArduPilot's OSD draws elements — battery voltage and current, altitude, RSSI,
heading, ground speed, throttle, the home arrow, the artificial horizon, and the
flight mode — onto a character grid, with up to four independent screens
(OSD1–OSD4). Each element is backed by three parameters per screen:

- ``OSDn_<ELEM>_EN`` — whether the element is drawn on screen *n*.
- ``OSDn_<ELEM>_X`` — its column (horizontal cell position).
- ``OSDn_<ELEM>_Y`` — its row (vertical cell position).

For example ``OSD1_BAT_VOLT_EN`` / ``OSD1_BAT_VOLT_X`` / ``OSD1_BAT_VOLT_Y``
control battery voltage on screen 1.

The tab works like Betaflight's OSD editor:

- An **element matrix** toggles each element on or off per screen (the enable
  checkbox writes ``OSDn_<ELEM>_EN``).
- A **live preview** lets you drag elements to reposition them; dragging stages
  the ``OSDn_<ELEM>_X`` / ``OSDn_<ELEM>_Y`` values as you cross cell boundaries.
  Number fields let you type an exact column/row instead.
- A **Screen** selector switches which of OSD1–OSD4 you are editing and
  previewing, and **Copy Layout** / **Paste Layout** moves a whole screen's
  layout to another.

Backend and screen options
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The **Backend** strip selects how the OSD is rendered:

- ``OSD_TYPE`` — the OSD backend: *Disabled*, *MAX7456* (analog), *SITL*, *MSP*,
  *TXONLY*, or *MSP DisplayPort*. (Changing it requires a reboot.)
- ``OSD_CHAN`` and ``OSD_SW_METHOD`` — the RC channel and method used to switch
  between screens.

Per-screen options (``OSDn_ENABLE``, ``OSDn_TXT_RES``, ``OSDn_FONT``,
``OSDn_CHAN_MIN`` / ``OSDn_CHAN_MAX``) live in the **Screen Options** strip, and
an MSP / DisplayPort card exposes ``MSP_OSD_NCELLS`` and the ``MSP_OPTIONS``
bitmask for DJI/Walksnail-style digital systems.

.. note::

   Measurement units (metric/imperial) are applied globally by ArduPilot's
   ``OSD_UNITS`` parameter, not per element — the app surfaces this as a
   read-only note rather than an editable field. The preview also offers PAL,
   NTSC, and HD grid sizes purely as a layout aid; the selection does not change
   any parameter.

VTX configuration
-----------------

The **VTX** tab controls a video transmitter over a SmartAudio or Tramp control
link (assign the control UART on the :doc:`ports-serial` tab first). The
parameters the app exposes are:

- ``VTX_ENABLE`` — turns VTX control on or off.
- ``VTX_FREQ`` — the transmit frequency in MHz.
- ``VTX_POWER`` — the output power in milliwatts.
- ``VTX_MAX_POWER`` — a cap on the power the VTX may use.
- ``VTX_OPTIONS`` — an advanced bitmask (pit mode, arming behaviour, and
  protocol tweaks), shown in hex.

The tab shows your requested **Selected Mode** alongside the VTX's reported
**Actual State** (device ready, frequency, power, max power) so you can confirm
the transmitter accepted the settings.

.. note::

   ArduPilot exposes the transmit **frequency in MHz** rather than a band/channel
   table, so the app edits ``VTX_FREQ`` directly — there is no Raceband-style
   band/channel picker here. Look up the frequency for the band and channel you
   want.

.. warning::

   Transmitting on the wrong frequency or at illegal power can break the law and
   ruin other pilots' video. Stick to the frequencies and power levels permitted
   where you fly, and use a low power (or pit mode) on the bench with no antenna
   risk.

See also the ArduPilot wiki: `On-Screen Display (OSD)
<https://ardupilot.org/copter/docs/common-osd-overview.html>`_ and `Video
Transmitters <https://ardupilot.org/copter/docs/common-vtx.html>`_.
