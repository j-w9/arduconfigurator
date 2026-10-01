OSD and VTX
===========

The **OSD** tab lays out the on-screen-display overlay drawn on your FPV video,
and the **VTX** sub-tab beside it configures the video transmitter. Both use the familiar
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

The **Backend** strip — shown expanded by default, since the backend is the
first thing to confirm — selects how the OSD is rendered:

- ``OSD_TYPE`` — the OSD backend: *Disabled*, *MAX7456* (analog), *SITL*, *MSP*,
  *TXONLY*, or *MSP DisplayPort*. (Changing it requires a reboot.) Choosing
  **MSP DisplayPort** as a serial-port function on the :doc:`ports-serial` tab
  sets this for you.
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
link. Assign the control UART on the :doc:`ports-serial` tab first — choosing
**IRC Tramp** or **SmartAudio** there stages ``VTX_ENABLE`` and the matching
``VTX_TYPES`` transport bit for you, so the transmitter is already enabled when
you reach this tab. The parameters the app exposes are:

- ``VTX_ENABLE`` — turns VTX control on or off.
- ``VTX_FREQ`` — the transmit frequency in MHz.
- ``VTX_POWER`` — the output power in milliwatts.
- ``VTX_MAX_POWER`` — a cap on the power the VTX may use.
- ``VTX_OPTIONS`` — an advanced bitmask (pit mode, arming behaviour, and
  protocol tweaks), shown in hex.

The tab shows your requested **Selected Mode** alongside the VTX's reported
**Actual State** (device ready, frequency, power, max power) so you can confirm
the transmitter accepted the settings.

Band table
~~~~~~~~~~

.. important::

   **The band table only exists if your firmware has it.** It is a build-time
   feature, not something every ArduPilot build carries, and there is no
   parameter to turn it on. The tab feature-detects it: where the firmware does
   not serve ``@VTX/vtxtable.dat`` you get a **"Table not available"** notice
   instead of the grid, and ``VTX_FREQ`` — a frequency in MHz — is how you set
   the channel. Everything in this section and the next applies only to builds
   that carry the feature.

Where the firmware does have it, it holds a band/channel map and the tab edits
it as a grid — band name, its OSD letter, whether it is a factory band, and the
frequency for each channel. It is transported as one blob over MAVLink FTP at
``@VTX/vtxtable.dat``.

A table can be imported or exported as a **Betaflight** ``vtxtable`` CLI
snippet, so a map shared in that format drops straight in, and curated presets
(Raceband and friends) load through the same path. **Load default bands**
restores the firmware's standard 11 bands — there is no reset command in the
protocol, so restoring them is itself an upload and goes through **Save**.

.. note::

   Only boards with **32 KB of parameter storage** (most H7s) can store a custom
   table; most F405s cannot. The firmware exposes no capability flag for this,
   so a well-formed table that is refused when the upload closes means the board
   has nowhere to put it — the app says so. Reading always works there and
   returns the built-in bands.

   On a digital/MSP video system the goggles own the table and push it to the
   flight controller, so the tab shows it read-only.

Power levels
~~~~~~~~~~~~

Power is **parameters** rather than part of the table blob — but the same
caveat applies: they exist only where the firmware exposes them, and the tab
says so rather than showing an editor for parameters that are not there.

``VTX_PWRTBL_EN`` turns the user power table on, and six slots ``VTX_PWRTBL1``
… ``VTX_PWRTBL6`` hold it in switch-position order. A slot is **unused**, **pit mode**, or a **power in
milliwatts** — enter mW for every protocol, including SmartAudio, because the
firmware stores mW and derives the dBm/dac step from it.

Because these are ordinary parameters they stage and apply like any other edit,
and on firmware that has them they work on **every board** — including one
whose parameter storage is too small to keep a band table.
There are no stored labels any more; the text shown is derived from the value
(1600 mW reads as "1.6").

.. warning::

   Transmitting on the wrong frequency or at illegal power can break the law and
   ruin other pilots' video. Stick to the frequencies and power levels permitted
   where you fly, and use a low power (or pit mode) on the bench with no antenna
   risk.

See also the ArduPilot wiki: `On-Screen Display (OSD)
<https://ardupilot.org/copter/docs/common-osd-overview.html>`_ and `Video
Transmitters <https://ardupilot.org/copter/docs/common-vtx.html>`_.
