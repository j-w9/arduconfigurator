Lua Scripts
===========

The **Lua Scripts** tab installs and manages ArduPilot Lua scripts on the
flight controller — curated applets from a bundled catalog, or your own
``.lua`` files — over MAVLink-FTP. It is a product-shaped front end for
ArduPilot's onboard scripting: enable the VM, drop scripts on the SD card, and
reboot to run them, without a file manager or the raw parameter tree.

Where it is
-----------

Lua Scripts is an **Expert-mode**, scripting-capable surface. It only appears
when the connected flight controller reports the ``SCR_ENABLE`` parameter — and
that parameter exists **only if the firmware was built with the Lua VM**. A
board on a stock, non-scripting build simply does not expose it, so the tab
stays hidden. Switch on Expert mode (top-right) and, if the firmware supports
scripting, the **Lua Scripts** tab appears in the sidebar.

Capability states
-----------------

The tab adapts to what the firmware reports:

- **Unsupported** — no ``SCR_ENABLE`` at all. The firmware has no Lua VM; flash
  a scripting-capable build to use scripts. Nothing to configure here.
- **Disabled** — ``SCR_ENABLE`` is ``0``. A one-click **Enable scripting**
  turns the VM on, and if the current ``SCR_HEAP_SIZE`` is low it stages a sane
  heap value at the same time. Both are staged and written like any other
  change, followed by a **reboot** to bring the VM up.
- **Enabled** — scripting is running. The tab shows the configured heap and
  **warns if it is low**, since an undersized heap is a common cause of scripts
  failing to load.

Installing scripts
------------------

Two ways to get a script onto the aircraft:

- **Install a curated applet** — one click from a bundled catalog of common
  ArduPilot applets. These are GPL-3.0, redistributed from the firmware's
  ``libraries/AP_Scripting/applets`` tree.
- **Upload your own** — pick a local ``.lua`` file and upload it.

Both write to the scripts directory over MAVFTP — ``/APM/scripts`` on ArduPilot
**hardware**, or ``/scripts`` on **SITL**. Installed scripts are listed, and you
can **remove** one from the same list. ArduPilot only loads scripts at startup,
so a **reboot** applies anything newly installed or removed.

Each catalog card shows a one-line summary with an expandable details section
and **best-effort prerequisite checks** behind its info bubble — for example, a
VTX applet notes that it wants a serial port set to **Scripting**, and a
rangefinder applet notes that it wants ``RNGFND*`` configured. These
prerequisites are **warnings, not blockers**: you can install regardless, and
they are there to flag the common "installed but did nothing" cases.

.. note::

   Scripts live on the SD card, so a **mounted SD card is required** — both to
   install them and for the firmware to run them. On a board with no card (or an
   unreadable one) there is nowhere for the scripts to go.

----

On the firmware side, the ArduPilot wiki is canonical for onboard scripting:
`Lua Scripts <https://ardupilot.org/copter/docs/common-lua-scripts.html>`__.
