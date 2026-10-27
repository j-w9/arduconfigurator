Flashing Firmware
=================

The **Flash** tab installs ArduPilot firmware onto your flight controller. It has
three sub-tabs:

- **Firmware (.apj)**: the normal ArduPilot serial-bootloader flow.
- **DFU (.hex)**: programs a raw ``.hex`` over WebUSB DFU.
- **Betaflight**: for boards still running Betaflight, which need to go into
  DFU before ArduPilot can be written to them.

.. warning::

   Flashing replaces the firmware on the board. **Do not unplug the flight
   controller while a flash is in progress.** An interrupted flash leaves the
   board with no valid firmware until a flash completes. Export your parameters
   first (Parameters → Export) if you want to restore your configuration
   afterward.

Getting into the bootloader
---------------------------

Both flows need the board in its bootloader. There are three ways in:

- **Request Reboot / Activate Bootloader (DFU)**: shown only when you're
  connected to a live vehicle. The DFU button asks you to confirm twice because
  it drops the MAVLink link. It sends ``MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN`` to
  reboot the board into its bootloader. The board then **stays in the bootloader
  until power-off**, so you don't need to hurry to click Flash.
- **Replug timing**: on boards without a DFU device, the serial bootloader runs
  for only a few seconds at power-up. The flasher walks you through it: unplug,
  click Continue, plug back in, and pick the new port. It listens on three paths
  at once (the ``connect`` event, a port-list poll, and the manual picker) for up
  to 30 seconds.
- **Hardware BOOT0**: power off, hold the **BOOT0** button (or bridge the BOOT0
  pads), then plug in. This is the most reliable way into DFU.

.. note::

   Software reboot-to-DFU is **unreliable on ArduPilot 4.6 and current 4.7**. If
   the board doesn't re-enumerate as a DFU device after "Activate DFU mode", use
   hardware BOOT0.

Updating the bootloader
-----------------------

**Update Bootloader** asks the *running firmware* to re-flash the board's
bootloader from the copy it carries in its own ROMFS. It does not upload a file.
The firmware you are running decides which bootloader you get.

**Compare Bootloaders** reads both images over MAVFTP: ``@ROMFS/bootloader.bin``
(what would be written) and the matching leading bytes of ``@SYS/flash.bin``
(what is installed). It shows their SHA-256 digests side by side with a verdict,
and writes nothing. The update itself still needs the two-click arm/confirm. The
comparison pulls tens of kilobytes over the link, so it runs only when you ask,
or when you arm the update.

ArduPilot answers the update command with ``ACCEPTED`` both when it wrote a new
bootloader and when it found the installed one identical and skipped the write
(``GCS_Common.cpp`` treats ``OK`` and ``NO_CHANGE`` alike, "so as not to display
error to user"). The comparison is the only way to know what happened, so the
app re-reads both images after the command and shows the result.

.. note::

   **There is no way to force an update from here.** The firmware compares the
   images itself in ``Util::flash_bootloader()`` and returns ``NO_CHANGE``
   without writing when they match. ``MAV_CMD_FLASH_BOOTLOADER`` has no force
   flag, only the magic value that authorises it. To rewrite a byte-identical
   bootloader, write the flash region directly over DFU.

Firmware (.apj)
---------------

The normal path: an ArduPilot ``.apj`` flashed over the board's serial
bootloader.

1. **Pick the firmware.** Choose your **Vehicle** (Copter, Plane, Rover, Sub,
   Blimp or AntennaTracker; pre-selected to match a connected board) and
   **Release** channel (Stable, Beta, or Latest/dev). The **Open ArduPilot
   downloads** link opens the matching folder on firmware.ardupilot.org.
2. **Drop the file you downloaded.** Find your exact board's folder, download its
   ``.apj``, and select it here. The app shows the board id, image size, and a
   *signed build* badge when the build is signed.
3. **Flash.** Tick the irreversibility confirmation, then click **Flash
   firmware** and follow the prompts. Progress shows as the firmware erases,
   writes, and verifies.

.. note::

   firmware.ardupilot.org sends no CORS headers, so the browser app cannot fetch
   from it directly. Download the ``.apj`` yourself (a normal browser download)
   and drop it in. The **desktop app** adds an in-app *fetch releases* path that
   detects the board id and pulls the matching build for you.

Before it erases, the flasher checks the image. It refuses a ``.apj`` whose
board id doesn't match the connected board, and refuses an image too large for
the board's flash. If the board already has the exact image (CRC match), it
offers to skip the re-flash. On dual-image boards (CubeOrange+, Pixhawk6X/6C,
Durandal H7, Here4) it writes the external-flash half too.

DFU (.hex)
----------

This path programs an ArduPilot ``.hex`` directly over **WebUSB DFU**, for a
board already in DFU mode (re-enumerated as an STM32 system bootloader). Put the
board in DFU (hardware BOOT0 or **Activate DFU mode**), load the ``.hex`` for
your board, and click **Flash via DFU**. The default **full chip erase** wipes
all flash before programming, which is the safe default for a clean reflash. The
firmware is then written and verified by read-back.

.. warning::

   WebUSB DFU needs Chrome or Edge on desktop. The ``.hex`` path is mainly for
   loading a bootloader or recovering a board. Use the ``.apj`` path to install
   ArduPilot normally.

Recovering a board
------------------

If a flash is interrupted or the board won't enumerate normally, put it back into
the bootloader/DFU mode (hardware BOOT0, or the DFU control) and re-flash. A board
in its bootloader still accepts a new image even if a previous flash didn't
complete. After a successful flash the board reboots into the new firmware. Go
to :doc:`../getting-connected` to reconnect, then :doc:`ports-serial` to set up
your serial ports.

For the firmware concepts behind this tab, see the ArduPilot wiki:
`Loading Firmware onto boards
<https://ardupilot.org/copter/docs/common-loading-firmware-onto-pixhawk.html>`__.

Coming from Betaflight
----------------------

Use the **Betaflight** sub-tab for a board that is still running Betaflight. It
reads what the board is, saves a record of its settings, and puts it into DFU so
one of the other two sub-tabs can write ArduPilot to it.

It uses its own serial connection, separate from the vehicle link. A Betaflight
board does not speak MAVLink, so it can never appear on the normal connection.
Connecting here does not disturb a connected ArduPilot vehicle.

.. note::

   If you connect to a Betaflight board the normal way, the app waits for a
   heartbeat that never arrives. It does not assume that silence means
   Betaflight, because silence has many ordinary causes, starting with the
   board's second USB serial interface. Come here when you know the board is
   running Betaflight.

**Connect Betaflight Board** reports the firmware variant and version, the
target, the board and manufacturer names, the MSP API version, and how many
UARTs it found.

Save the settings first
~~~~~~~~~~~~~~~~~~~~~~~

**Save Settings (diff .txt)** saves the board's ``diff`` (its non-default
settings) as a Betaflight CLI text file. The file is named and CRLF-terminated
the same way Betaflight Configurator does it, so it opens correctly in Notepad
and compares cleanly against a file saved by Betaflight Configurator. You can
paste it straight back into Betaflight's CLI if you go back. The ``diff`` is
read once when you connect, so saving is instant. The read is read-only and
leaves the CLI with ``exit noreboot``, so it never restarts the board.

Do this **before** rebooting to DFU. Once ArduPilot is flashed those settings are
gone, and this file is the only record of them.

What the board had wired up
~~~~~~~~~~~~~~~~~~~~~~~~~~~

The card also lists what Betaflight had on each UART next to its ArduPilot
equivalent: a serial receiver becomes ``RCIN``, SmartAudio becomes
``SmartAudio``, and so on. Whatever is soldered to a UART is still there after
the flash, so you can use this list to set up the ports.

Ports are named as on the board and in Betaflight's Ports tab (``UART1``,
``UART6``). MSP reports a zero-based serial identifier instead (identifier 5 is
UART6). The USB port is left out. Every Betaflight board carries MSP on it (that is how
Betaflight Configurator talks to the board), and nothing is wired to it to carry
over.

**MSP DisplayPort** (goggle OSD over MSP) is read from the saved ``diff``, not
the serial config. Betaflight does not record it as a serial function: the UART
carries plain MSP, and ``osd_displayport_device = MSP`` makes it a display link. It maps to ArduPilot's ``DisplayPort``
(``SERIALn_PROTOCOL`` 42), which is a different protocol from ``MSP``.

The card does **not** map ports for you. Betaflight serial identifiers and
ArduPilot ``SERIALn`` indexes number the same hardware differently, board by
board, and a guess could put a GPS on the receiver's port. Once ArduPilot is
running, match them on the :doc:`ports-serial` tab by what is physically on each
UART.

Two Betaflight functions have no ArduPilot equivalent, and the card says so:
**Blackbox** (ArduPilot logs to dataflash, not a serial
port) and **Tramp**.

Reboot to DFU
~~~~~~~~~~~~~

**Reboot to DFU** asks the board to restart into the STM32 ROM bootloader. The
board acknowledges and reboots, and the link drops immediately. This is
expected. The board comes back as a DFU device. Switch to **DFU (.hex)** or
**Firmware (.apj)** and flash ArduPilot as normal.
