Lua Scripts
===========

The **Lua Scripts** tab installs and manages ArduPilot Lua scripts on the
flight controller over MAVLink-FTP. You can install curated applets from a
bundled catalog, or your own ``.lua`` files. From this tab you enable the VM,
put scripts on the SD card and reboot to run them, without a file manager or
the raw parameter tree.

Where it is
-----------

Lua Scripts is an **Expert-mode** tab. It only appears when the connected
flight controller reports the ``SCR_ENABLE`` parameter, and that parameter
exists **only if the firmware was built with the Lua VM**. A board on a
non-scripting build does not expose it, so the tab stays hidden. Switch on Expert mode (top-right) and, if the firmware supports
scripting, the **Lua Scripts** tab appears in the sidebar.

Capability states
-----------------

The tab adapts to what the firmware reports:

- **Unsupported**: no ``SCR_ENABLE`` at all. The firmware has no Lua VM. Flash
  a scripting-capable build to use scripts. There is nothing to configure here.
- **Disabled**: ``SCR_ENABLE`` is ``0``. A one-click **Enable scripting**
  turns the VM on. If the current ``SCR_HEAP_SIZE`` is low, it also stages a
  suitable heap value. Both are staged and written like any other
  change, followed by a **reboot** to bring the VM up.
- **Enabled**: scripting is running. The tab shows the configured heap and
  **warns if it is low**. An undersized heap is a common cause of scripts
  failing to load.

Installing scripts
------------------

Two ways to get a script onto the aircraft:

- **Install a curated applet**: one click from a bundled catalog of common
  ArduPilot applets. These are GPL-3.0, redistributed from the firmware's
  ``libraries/AP_Scripting/applets`` tree.
- **Upload your own**: pick a local ``.lua`` file and upload it.

Both write to the scripts directory over MAVFTP: ``/APM/scripts`` on ArduPilot
**hardware**, or ``/scripts`` on **SITL**. Installed scripts are listed, and you
can **remove** one from the list. ArduPilot only loads scripts at startup,
so a **reboot** applies anything newly installed or removed.

Each catalog card shows a one-line summary with an expandable details section
and **best-effort prerequisite checks** behind its info bubble. For example, a
VTX applet notes that it needs a serial port set to **Scripting**, and a
rangefinder applet notes that it needs ``RNGFND*`` configured. These
prerequisites are **warnings, not blockers**. You can install anyway. They flag
the common cases where a script installs but does nothing.

.. note::

   Scripts live on the SD card, so a **mounted SD card is required**, both to
   install them and for the firmware to run them. A board with no card (or an
   unreadable one) has nowhere to store the scripts.

----

On the firmware side, the ArduPilot wiki is canonical for onboard scripting:
`Lua Scripts <https://ardupilot.org/copter/docs/common-lua-scripts.html>`__.
