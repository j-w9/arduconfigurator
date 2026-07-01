Flashing Firmware
=================

The **Flash** tab installs ArduPilot firmware onto your flight controller. It has
two sub-tabs: **Firmware (.apj)**, the normal ArduPilot serial-bootloader flow,
and **DFU (.hex)**, which programs a raw ``.hex`` over WebUSB DFU.

.. warning::

   Flashing replaces the firmware on the board. **Do not unplug the flight
   controller while a flash is in progress** — an interrupted flash leaves the
   board with no valid firmware until a flash completes. Export your parameters
   first (Parameters → Export) if you want to restore your configuration
   afterward.

Getting into the bootloader
---------------------------

Both flows need the board in its bootloader. There are three ways in:

- **Request Reboot / Activate Bootloader (DFU)** — shown only when you're
  connected to a live vehicle. The DFU button is a two-step confirm (it drops the
  MAVLink link), and sends ``MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN`` to reboot the
  board into its bootloader. The board then **stays in the bootloader until
  power-off**, so there's no rush to click Flash.
- **Replug timing** — on boards without a DFU device the serial bootloader only
  runs for a few seconds at power-up. The flasher walks you through it: unplug,
  click Continue, plug back in, and pick the new port. It listens on three paths
  at once (the ``connect`` event, a port-list poll, and the manual picker) for up
  to 30 seconds.
- **Hardware BOOT0** — power off, hold the **BOOT0** button (or bridge the BOOT0
  pads), then plug in. This is the most reliable route into DFU.

.. note::

   Software reboot-to-DFU is **flaky on ArduPilot 4.6 and current 4.7**. If the
   board doesn't re-enumerate as a DFU device after "Activate DFU mode", fall back
   to the hardware BOOT0 method.

Firmware (.apj)
---------------

The normal path — an ArduPilot ``.apj`` flashed over the board's serial
bootloader.

1. **Pick the firmware.** Choose your **Vehicle** (Copter, Plane, Rover, Sub,
   Blimp, AntennaTracker — pre-selected to match a connected board) and
   **Release** channel (Stable, Beta, or Latest/dev). The **Open ArduPilot
   downloads** link opens the matching folder on firmware.ardupilot.org.
2. **Drop the file you downloaded.** Find your exact board's folder, download its
   ``.apj``, and select it here. The app shows the board id, image size, and a
   *signed build* badge if the build was signed.
3. **Flash.** Tick the irreversibility confirmation, then click **Flash
   firmware** and follow the prompts. Progress is shown as the firmware erases,
   writes, and verifies.

.. note::

   firmware.ardupilot.org sends no CORS headers, so the browser app cannot fetch
   it directly — you download the ``.apj`` yourself (a normal browser download)
   and drop it in. The **desktop app** adds an in-app *fetch releases* path that
   detects the board id and pulls the matching build for you. You can also point
   the **custom build server** field at an internal CI mirror, but that server
   must allow this origin (CORS).

Before it erases, the flasher guards the write: it refuses a ``.apj`` whose board
id doesn't match the connected board, and refuses an image too large for the
board's flash. If the board already has the exact image (CRC match), it offers to
skip the re-flash. Dual-image boards (CubeOrange+, Pixhawk6X/6C, Durandal H7,
Here4) have their external-flash half written too.

DFU (.hex)
----------

A separate path that programs an ArduPilot ``.hex`` directly over **WebUSB DFU**,
for a board that's already in DFU mode (re-enumerated as an STM32 system
bootloader). Put the board in DFU (hardware BOOT0 or **Activate DFU mode**), load
the ``.hex`` for your board, and click **Flash via DFU**. The default **full chip
erase** wipes all flash before programming — the safe default for a clean
reflash — then the firmware is written and verified by read-back.

.. warning::

   WebUSB DFU needs Chrome or Edge on desktop. The ``.hex`` path is mainly for
   loading a bootloader or recovering a board; the ``.apj`` path is the normal way
   to install ArduPilot.

Recovering a board
------------------

If a flash is interrupted or the board won't enumerate normally, put it back into
the bootloader/DFU mode (hardware BOOT0, or the DFU control) and re-flash. A board
in its bootloader still accepts a new image even if a previous flash didn't
complete. After a successful flash the board reboots into the new firmware — go
to :doc:`../getting-connected` to reconnect, then :doc:`ports-serial` to set up
your serial ports.

For the firmware concepts behind this tab, see the ArduPilot wiki:
`Loading Firmware onto boards
<https://ardupilot.org/copter/docs/common-loading-firmware-onto-pixhawk.html>`__.
