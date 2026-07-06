Files
=====

The **Files** tab is a MAVLink-FTP file browser for the flight controller's
onboard filesystem. It lets you browse directories, download files to your
computer, upload files to the board, and delete files — the same transport the
:doc:`logs-inspectors` tab uses to pull logs, exposed as a general-purpose
browser.

Two roots are visible:

- **``@SYS``** — virtual status files served from RAM (crash-dump summaries,
  threads, memory, and other diagnostics). These are **read-only**.
- **The SD card under ``/APM``** — the real filesystem: ``/APM/LOGS`` (dataflash
  logs), ``/APM/TERRAIN`` (terrain tiles), ``/APM/scripts`` (Lua scripts), and
  more.

.. note::

   Two real gotchas govern what you can reach:

   - **ArduPilot blocks SD-card filesystem access while the vehicle is ARMED.**
     This is a flight-timing safeguard on the firmware side — listing or opening
     anything under ``/APM`` fails until you disarm. ``@SYS`` still works while
     armed because it is RAM-backed, not on the card.
   - **SD access needs a mounted FAT32 card.** A missing, unformatted, or
     corrupt card makes every ``/APM`` operation fail, even disarmed. ``@SYS`` is
     unaffected.

Sanitize
--------

**Sanitize** (the red button) is a fast one-shot cleanup: it deletes everything
that is not needed for flight — ``/APM/LOGS``, ``/APM/TERRAIN``, and crash dumps
— while **keeping** your configuration. Parameters are safe because they live in
storage/FRAM, not in files; scripts and missions are kept too. It is the quick
way to hand off or resell a board, or reclaim card space, without wiping the
tune.

.. warning::

   Sanitize is a **normal file delete, not a secure wipe**. The confirmation
   dialog says so explicitly: SD and flash wear-levelling can leave deleted data
   recoverable by forensic tools. If you need a *guaranteed* wipe — for a board
   leaving your control with sensitive mission data — pull the card and
   physically destroy it.
