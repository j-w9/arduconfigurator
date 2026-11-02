Files
=====

The **Files** tab is a MAVLink-FTP file browser for the flight controller's
onboard filesystem. You can browse directories, download files to your
computer, upload files to the board and delete files. It uses the same transport
the :doc:`logs-inspectors` tab uses to pull logs.

The toolbar jumps to **@SYS**, **/APM**, **/APM/scripts** and **/APM/LOGS**;
**Refresh** re-lists the current directory and **Upload file** puts a file from
your computer into it. Each row has **Download** and **Delete**. Two roots are
visible:

- ``@SYS``: virtual status files (threads, memory, timers and other
  diagnostics, and ``crash_dump.bin`` when the board has one). These are
  **read-only**, so the Files tab offers no **Delete** for them.
- The SD card under ``/APM``: the real filesystem: ``/APM/LOGS`` (dataflash
  logs), ``/APM/TERRAIN`` (terrain tiles), ``/APM/scripts`` (Lua scripts), and
  more.

.. note::

   Two limits control what you can reach:

   - **ArduPilot blocks SD-card filesystem access while the vehicle is ARMED.**
     This is a flight-timing safeguard in the firmware. Listing or opening
     anything under ``/APM`` fails until you disarm. ``@SYS`` still works while
     armed because it is in RAM, not on the card.
   - **SD access needs a mounted FAT32 card.** A missing, unformatted, or
     corrupt card makes every ``/APM`` operation fail, even disarmed. ``@SYS`` is
     unaffected.

Crash dump
----------

``@SYS/crash_dump.bin`` appears after the firmware hits a hard fault (an illegal
instruction or bad memory access) and the watchdog reboots the board. ArduPilot
4.5 and later then refuses to arm with *CrashDump data detected*.

The dump is stored in the board's flash, not on the SD card, so it cannot be
deleted. To clear it:

#. **Download** ``crash_dump.bin``, and keep the log from the flight it happened
   on. Send both to whoever builds your firmware; the dump is what shows the
   cause.
#. Save a parameter backup.
#. **Re-flash the firmware** on the :doc:`Flash <first-time-setup/flashing-firmware>`
   tab. A normal flash clears the dump; you do not need a full chip erase,
   which on many boards also erases parameters.

``ARMING_CRSDP_IGN = 1`` hides the pre-arm failure instead. ArduPilot advises
against it: a crash dump means the firmware hit a critical fault, and the
vehicle may not be safe to fly.

Free storage
------------

**Free storage** (the red button) is a one-shot cleanup. It deletes everything
that is not needed for flight (``/APM/LOGS`` and ``/APM/TERRAIN``) and **keeps**
your configuration. Parameters are safe because they live in
storage/FRAM, not in files. Scripts and missions are kept too. Use it to free
card space, or to hand off or resell a board without wiping the tune.

.. warning::

   This is a **normal file delete, not a secure wipe**. The confirmation
   dialog says so: SD and flash wear-levelling can leave deleted data
   recoverable by forensic tools. If you need a *guaranteed* wipe (for a board
   leaving your control with sensitive mission data), pull the card and
   physically destroy it.

Format SD card
--------------

**Format SD card…** asks the flight controller to format its card
(``MAV_CMD_STORAGE_FORMAT``). Use it for a card that mounts but misbehaves, or
one that arrived with the wrong filesystem. It erases **everything** on the
card, logs and scripts included. Parameters are unaffected, since they live in
storage/FRAM. The button opens a typed confirmation. After the format, the tab
advises a **reboot**: the card is empty, and ArduPilot recreates its ``/APM``
folders at boot.
