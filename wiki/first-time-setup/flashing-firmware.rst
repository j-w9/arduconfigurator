Flashing Firmware
=================

The **Flash** tab installs ArduPilot firmware onto your flight controller. It has
three sub-tabs: **Firmware (.apj)**, the normal ArduPilot serial-bootloader flow;
**DFU (.hex)**, which programs a raw ``.hex`` over WebUSB DFU; and
**Betaflight**, for boards that are still running Betaflight and need to be put
into DFU before ArduPilot can be written to them.

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

Updating the bootloader
-----------------------

**Update Bootloader** asks the *running firmware* to re-flash the board's
bootloader from the copy it carries in its own ROMFS. It is not a file upload:
the firmware you are running decides which bootloader you get.

**Compare Bootloaders** answers the question first. It reads both images over
MAVFTP — ``@ROMFS/bootloader.bin`` (what would be written) and the matching
leading bytes of ``@SYS/flash.bin`` (what is installed) — and shows their
SHA-256 digests side by side with a verdict. It reads only; nothing is written,
and the two-click arm/confirm gate on the update itself is unchanged. The read
happens only when you ask for it, or when you arm the update, because it pulls
tens of kilobytes over the link.

This matters because of what the vehicle reports back: ArduPilot answers the
update command with ``ACCEPTED`` whether it wrote a new bootloader or found the
installed one identical and skipped the write
(``GCS_Common.cpp`` treats ``OK`` and ``NO_CHANGE`` alike, "so as not to display
error to user"). The comparison is therefore the only way to know what actually
happened — so the app re-reads both images after the command and shows the
result.

.. note::

   **There is no way to force an update from here.** The firmware compares the
   images itself in ``Util::flash_bootloader()`` and returns ``NO_CHANGE``
   without writing when they match, and ``MAV_CMD_FLASH_BOOTLOADER`` carries no
   force flag — only the magic value that authorises it. Rewriting a
   byte-identical bootloader means writing the flash region directly over DFU.

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
   detects the board id and pulls the matching build for you.

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

Coming from Betaflight
----------------------

The **Betaflight** sub-tab is for a board that is still running Betaflight. It
reads what the board is, keeps a record of its settings, and puts it into DFU so
one of the other two sub-tabs can write ArduPilot to it.

It uses its own serial connection, separate from the vehicle link — a Betaflight
board does not speak MAVLink, so it can never appear on the normal connection,
and connecting here does not disturb a connected ArduPilot vehicle.

.. note::

   If you connect to a Betaflight board the normal way, the app sits waiting for
   a heartbeat that will never arrive. After a few seconds it says so —
   *"Connected, but nothing is talking"* — and offers to bring you here.

**Connect Betaflight Board** reports the firmware variant and version, the
target, the board and manufacturer names, the MSP API version, and how many
UARTs it found.

Save the settings first
~~~~~~~~~~~~~~~~~~~~~~~

**Save Settings (diff .txt)** writes the board's own ``diff`` — its non-default
settings — as a Betaflight CLI text file, named the way Betaflight Configurator
names its own. It pastes straight back into Betaflight's CLI if you ever go
back.

Do this **before** rebooting to DFU. Once ArduPilot is flashed those settings are
gone, and this file is the only record of them.

What the board had wired up
~~~~~~~~~~~~~~~~~~~~~~~~~~~

The card also lists what Betaflight had on each UART beside its ArduPilot
equivalent — a serial receiver becomes ``RCIN``, SmartAudio becomes
``SmartAudio``, and so on. Whatever is soldered to a UART is still soldered
there after the flash, so this saves re-deriving the port setup by hand.

It deliberately does **not** map ports for you. A Betaflight serial identifier
and an ArduPilot ``SERIALn`` index are different numbering over the same
hardware, and which is which depends on the board — guessing would put a GPS on
the receiver's port. Match them by what is physically on each UART, on the
:doc:`ports-serial` tab, once ArduPilot is running.

A couple of Betaflight functions have no ArduPilot equivalent and say so rather
than being given one: **Blackbox** (ArduPilot logs to dataflash, not a serial
port) and **Tramp**.

Reboot to DFU
~~~~~~~~~~~~~

**Reboot to DFU** asks the board to restart into the STM32 ROM bootloader. The
board acknowledges and then reboots, so the link drops immediately — that is
expected. It comes back as a DFU device; switch to **DFU (.hex)** or
**Firmware (.apj)** and flash ArduPilot as normal.
