OSD and VTX
===========

The **OSD** tab lays out the on-screen-display overlay drawn on your FPV video,
and the **VTX** sub-tab beside it configures the video transmitter. Both use
staged drafts: edits accumulate until you write them. On OSD, **Save** writes
them and **Revert** discards them. On VTX, the changes bar at the top writes
them (**Write all**) or discards them.

OSD layout
----------

ArduPilot's OSD draws elements onto a character grid: battery voltage and
current, altitude, RSSI, heading, ground speed, throttle, the home arrow, the
artificial horizon, and the flight mode. There are up to four independent
screens (OSD1–OSD4). Each element has three parameters per screen:

- ``OSDn_<ELEM>_EN``: whether the element is drawn on screen *n*.
- ``OSDn_<ELEM>_X``: its column (horizontal cell position).
- ``OSDn_<ELEM>_Y``: its row (vertical cell position).

For example ``OSD1_BAT_VOLT_EN`` / ``OSD1_BAT_VOLT_X`` / ``OSD1_BAT_VOLT_Y``
control battery voltage on screen 1.

The tab works like Betaflight's OSD editor:

- An **element matrix** toggles each element on or off per screen. The enable
  checkbox writes ``OSDn_<ELEM>_EN``.
- A **live preview** lets you drag elements to reposition them. Dragging stages
  the ``OSDn_<ELEM>_X`` / ``OSDn_<ELEM>_Y`` values as you cross cell boundaries.
  Number fields let you type an exact column/row instead.
- A **Screen** selector switches which of OSD1–OSD4 you are editing and
  previewing. **Copy Layout** / **Paste Layout** copies a whole screen's layout
  to another.

Backend and screen options
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The **Backend** strip selects how the OSD is rendered. It is expanded by
default, because the backend is the first thing to confirm:

- ``OSD_TYPE``: the OSD backend. *Disabled*, *MAX7456* (analog), *SITL*, *MSP*,
  *TXONLY*, or *MSP DisplayPort*. Changing it requires a reboot. Choosing
  **MSP DisplayPort** as a serial-port function on the :doc:`ports-serial` tab
  sets this for you.
- ``OSD_CHAN`` and ``OSD_SW_METHOD``: the RC channel and method used to switch
  between screens.

Per-screen options (``OSDn_ENABLE``, ``OSDn_TXT_RES``, ``OSDn_FONT``,
``OSDn_CHAN_MIN`` / ``OSDn_CHAN_MAX``) are in the **Screen Options** strip. An
MSP / DisplayPort card shows ``MSP_OSD_NCELLS`` and the ``MSP_OPTIONS`` bitmask
for DJI/Walksnail-style digital systems.

.. note::

   ArduPilot applies measurement units (metric/imperial) globally through the
   ``OSD_UNITS`` parameter, not per element. The app shows it as a read-only
   note. The preview also offers PAL, NTSC, and HD grid sizes as a layout aid
   only. The selection does not change any parameter.

VTX configuration
-----------------

The **VTX** tab controls a video transmitter over a SmartAudio or Tramp control
link. Assign the control UART on the :doc:`ports-serial` tab first. Choosing
**IRC Tramp** or **SmartAudio** there stages ``VTX_ENABLE`` and the matching
``VTX_TYPES`` transport bit for you, so the transmitter is already enabled when
you reach this tab. The tab shows these parameters:

- ``VTX_ENABLE``: turns VTX control on or off.
- ``VTX_FREQ``: the transmit frequency in MHz.
- ``VTX_POWER``: the output power in milliwatts. **Pit mode (0 mW)** stages 0.
  On a SmartAudio 2.1 VTX (TBS Unify Pro32) 0 mW puts it into pit mode, and
  any other power takes it out. The ``VTX_OPTIONS`` pit-mode bit on these VTXs
  only sets whether the VTX starts in pit mode at the next power-up.
- ``VTX_MAX_POWER``: a cap on the power the VTX may use.
- ``VTX_OPTIONS``: an advanced bitmask (pit mode, arming behaviour, and
  protocol tweaks), shown in hex.

The tab shows your requested **Selected Mode** next to the VTX's reported
**Actual State** (device ready, frequency, power, max power), so you can confirm
the transmitter accepted the settings.

.. warning::

   Transmitting on the wrong frequency or at illegal power can break the law and
   ruin other pilots' video. Stick to the frequencies and power levels permitted
   where you fly, and use a low power (or pit mode) on the bench with no antenna
   risk.

See also the ArduPilot wiki: `On-Screen Display (OSD)
<https://ardupilot.org/copter/docs/common-osd-overview.html>`_ and `Video
Transmitters <https://ardupilot.org/copter/docs/common-vtx.html>`_.
