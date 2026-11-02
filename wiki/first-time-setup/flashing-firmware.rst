Flashing Firmware
=================

The **Flash** tab installs ArduPilot firmware onto your flight controller. It has
three sub-tabs:

- **Firmware (.apj)**: the normal ArduPilot serial-bootloader flow.
- **DFU (.hex)**: programs a raw ``.hex`` over WebUSB DFU.
- **Betaflight**: for boards still running Betaflight, which need to go into
  DFU before ArduPilot can be written to them.

.. warning::

   **Do not unplug the flight controller while a flash is in progress.** An
   interrupted flash leaves the board with no valid firmware until a flash
   completes. Take a snapshot or export a parameter backup first
   (:doc:`../parameters`) if you want your configuration back afterward.

The **Debug log** button at the bottom of the tab keeps a timestamped record of
what the flasher did. Attach it to a bug report.

Getting into the bootloader
---------------------------

Both flows need the board in its bootloader. There are four ways in:

- **Let the flasher do it** (the normal path). With a vehicle connected,
  **Flash firmware** reboots the board into its bootloader (*Rebooting into the
  bootloader…*), flashes, and reconnects to the new firmware (*Flash complete —
  rebooting & reconnecting*).
- **Request Reboot / Activate Bootloader**: the connected-vehicle actions at
  the top of the tab. *Activate Bootloader* sends
  ``MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN`` to reboot into ArduPilot's own
  bootloader. It asks you to confirm twice because it drops the MAVLink link.
  The board stays in the bootloader until power-off, so you don't need to hurry
  to click Flash. **Enter DFU (STM32 ROM)** reboots into the STM32 ROM DFU
  bootloader for the **DFU (.hex)** tab. **Reset Parameters to Defaults** sits
  beside them. It is not a bootloader action, but you often want it after a
  fresh flash.
- **Replug timing**: on boards without a DFU device, the serial bootloader runs
  for only a few seconds at power-up. The flasher walks you through it: unplug,
  click **Continue**, plug back in, and pick the new port within about a
  second. It watches for the port for up to 30 seconds. If this browser has
  seen the board's bootloader before, Chrome already holds the grant and the
  picker is skipped.
- **Hardware BOOT0**: power off, hold the **BOOT0** button (or bridge the BOOT0
  pads), then plug in. This is the most reliable way into DFU.

.. note::

   Software reboot-to-DFU is unreliable on ArduPilot 4.6 and current 4.7. If
   the board does not re-enumerate as a DFU device after **Activate DFU mode**,
   use hardware BOOT0.

Updating the bootloader
-----------------------

**Update Bootloader** asks the *running firmware* to re-flash the board's
bootloader from the copy it carries in its own ROMFS. It does not upload a file.
The firmware you are running decides which bootloader you get.

**Compare Bootloaders** reads both images over MAVFTP: ``@ROMFS/bootloader.bin``
(what would be written) and the leading bytes of ``@SYS/flash.bin`` (what is
installed). It shows their SHA-256 digests with a verdict, and writes nothing.
It pulls tens of kilobytes over the link, so it runs only when you ask, or when
you arm the update.

ArduPilot answers the update command with ``ACCEPTED`` both when it wrote a new
bootloader and when it found the installed one identical and skipped the write
(``GCS_Common.cpp`` treats ``OK`` and ``NO_CHANGE`` alike). The comparison is
the only way to know what happened, so the app re-reads both images after the
command.

.. note::

   You cannot force an update from here. The firmware returns ``NO_CHANGE``
   without writing when the images match, and ``MAV_CMD_FLASH_BOOTLOADER`` has
   no force flag. To rewrite an identical bootloader, write the flash region
   over DFU.

Firmware (.apj)
---------------

The normal path: an ArduPilot ``.apj`` flashed over the board's serial
bootloader.

1. **Pick the firmware.** Choose the **Vehicle** (Copter, Plane, Rover, Sub,
   Blimp or AntennaTracker; pre-selected to match a connected board) and the
   **Release** channel: *Stable (recommended)*, *Beta* or *Latest (dev)*. On
   arduconfigurator.com the finder lists ArduPilot's published builds with the
   connected board's own build pre-selected. **Search** by board name, and
   **Download <board> <version>** fetches it into the flasher. Or use **Open
   ArduPilot downloads ↗** to get it yourself from firmware.ardupilot.org.
2. **Drop the file** (only if you downloaded it yourself). Pick your exact
   board's ``.apj``. The app shows its board id, image size, and a *signed
   build* badge when the build is signed.
3. **Flash.** Tick *I understand flashing is irreversible and won't unplug until
   it completes*, then click **Flash firmware** and follow the prompts. Progress
   shows as the firmware erases, writes, and verifies. The step count on the
   tab is *1 · 2 · 3* when you drop a file and *1 · 2* when the finder fetched
   it.

.. note::

   A browser cannot fetch from firmware.ardupilot.org directly (no CORS
   headers), so arduconfigurator.com relays the builds for the finder. A build
   of the app without that relay, such as a local build or the desktop shell's
   bundled page, hides the finder and keeps the download link. The desktop app
   fetches in-app instead (**Or fetch in-app (desktop)**): it detects the board
   id and pulls the matching build.

Before it erases, the flasher checks the image. It refuses a ``.apj`` whose
board id doesn't match the connected board, and refuses an image too large for
the board's flash. If the board already has the exact image (CRC match), it
offers to skip the re-flash. On dual-image boards (CubeOrange+, Pixhawk6X/6C,
Durandal H7, Here4) it writes the external-flash half too.

DFU (.hex)
----------

This path programs an ArduPilot ``.hex`` over **WebUSB DFU**, for a board
already in DFU mode (enumerated as an STM32 system bootloader).

1. Put the board in DFU: hardware BOOT0, or **Activate DFU mode** on a connected
   vehicle (*How do I put the board in DFU mode?* walks through it).
2. Load the ``.hex`` for your board. On arduconfigurator.com the finder offers
   ArduPilot's ``*_with_bl.hex`` builds: firmware with the bootloader in front,
   which is what a board in ROM DFU needs.
3. Click **Flash via DFU**.

**Full chip erase first (recommended)** wipes all flash before programming. The
firmware is then written and verified by read-back. A real H7 erase takes a
while, and the flasher waits for it. It keeps its pace when the tab is in the
background.

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
board does not speak MAVLink, and connecting here does not disturb a connected
ArduPilot vehicle.

.. note::

   If you connect to a Betaflight board the normal way, the app waits for a
   heartbeat that never arrives. It does not assume that silence means
   Betaflight. Come here when you know the board is running it.

**Connect Betaflight Board** reports the firmware variant and version, the
target, the board and manufacturer names, the MSP API version, and how many
UARTs it found.

Save the settings first
~~~~~~~~~~~~~~~~~~~~~~~

**Save Settings (diff .txt)** saves the board's ``diff`` (its non-default
settings) as a Betaflight CLI text file. The file is named and CRLF-terminated
the same way Betaflight Configurator does it, so it opens in Notepad and
compares cleanly. You can paste it straight back into Betaflight's CLI if you go
back. The ``diff`` is read once at connect, so saving is instant. The read
leaves the CLI with ``exit noreboot`` and never restarts the board.

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
UART6). The USB port is left out: it only carries MSP and nothing is wired to
it.

**MSP DisplayPort** (goggle OSD over MSP) is read from the saved ``diff``.
Betaflight does not record it as a serial function. It records
``osd_displayport_device = MSP`` on a plain MSP UART. It maps to ArduPilot's
``DisplayPort`` (``SERIALn_PROTOCOL`` 42), which is a different protocol from
``MSP``.

The card does not map ports for you. Betaflight serial identifiers and
ArduPilot ``SERIALn`` indexes number the same hardware differently, board by
board, and a guess could put a GPS on the receiver's port. Once ArduPilot is
running, match them on the :doc:`ports-serial` tab by what is on each UART.

Two Betaflight functions have no ArduPilot equivalent, and the card says so:
**Blackbox** (ArduPilot logs to dataflash, not a serial port) and **Tramp**.

Reboot to DFU
~~~~~~~~~~~~~

**Reboot to DFU** asks the board to restart into the STM32 ROM bootloader. The
board acknowledges and reboots, and the link drops. This is expected. The board
comes back as a DFU device. Switch to **DFU (.hex)** or **Firmware (.apj)** and
flash ArduPilot as normal.
