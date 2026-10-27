Logs & Inspectors
=================

After a flight, pull the onboard dataflash logs off the autopilot. During a
session, watch the live link. This page covers downloading onboard logs and the
two Expert-mode live inspectors: the **MAVLink Inspector** for the telemetry
stream and the **DroneCAN Inspector** for the CAN bus.

Onboard logs
------------

The **Logs** tab lists the dataflash (``.BIN``) logs stored on the flight
controller and downloads them to your computer. **List** lists them. The
per-log download button saves one, with a progress bar as it streams.

The app reads logs in one of two ways and picks for you:

- **MAVFTP**: tried first, whatever the board advertises, because it reads the
  real directory. It is a faster burst read and gives the on-FC filenames.
  ArduPilot **hardware** serves logs from ``/APM/LOGS`` and **SITL** from
  ``/logs``. The app tries the hardware path first, then the SITL one.
- **LOG_\***: the classic dataflash stream (``LOG_REQUEST_LIST`` /
  ``LOG_REQUEST_DATA``), used only when MAVFTP cannot answer.

.. note::

   This order matters after an **erase**. The ``LOG_*`` list is not built from
   the files. The vehicle derives it from ``LASTLOG.TXT``, which ArduPilot
   removes only at the *end* of the erase sequence
   (``AP_Logger_File::erase_next``). Until then, or for good if the erase is
   interrupted, an FC can list logs that are no longer on the card. The stale
   number survives a reconnect because it lives on the SD card. Because the app
   reads the directory, the Logs and **Files** tabs always describe the same
   card. If another GCS still shows the old logs after an erase, it is reading
   ``LASTLOG.TXT``.

Downloaded files get a **self-describing name**, so a folder of logs from
several craft stays readable instead of colliding as ``onboard-log-1.bin``. The
name has a board tag (the autopilot's unique id ``uid_…`` when the firmware
reports a real one, else the firmware git hash ``fw_…``, else ``ardupilot``),
the log number, and a UTC date stamp when the FC timestamped the log. For
example::

   uid_2300...e7_date_20240602-000000_log7.bin

.. note::

   If a download stalls at 0%, the autopilot may still think another log
   transfer is active (a lost ``LOG_REQUEST_END``, or a second ground station
   attached). The app retries, re-sending ``LOG_REQUEST_END`` first to clear
   the stuck transfer. If it keeps failing, disconnect other ground stations or
   reboot the flight controller and try again.

Uploading to a log server
-------------------------

You can send logs directly to your own **ArduLogs** server instead of saving
them locally and moving them by hand. Sign in from the Logs tab (server
address, username, password), and each log gets an **Upload to server** button
next to its download button. The password is used once to get a token and is
never stored. The token lasts until the tab closes.

Uploads carry the log's descriptive name, the flight date, and an optional note,
so you can find a log in the archive without opening it.

Reading a log straight off the vehicle
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every card that takes a ``.bin`` (**Log Tuning**, **Hover throttle from a log**,
**Baro thrust calibration (VALT)**) has **Pick from vehicle** next to its file
chooser. It lists the logs still on the aircraft and reads the one you choose
directly from it, with no download and re-upload step.

The list is read once and shared by every card. A reconnect (often after a new
flight) clears it and reads it again once parameters have synced, so the
newest log is there without a trip to the Logs tab. **Refresh** next to the
dropdown re-reads it at any time.

The baro thrust calibration can use it
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The **Baro thrust (VALT)** calibration on **Calibration → Flight** is the only
calibration whose entire input is a flight log. The scale it produces is only as
good as the hover behind it, so keep that log where you can get it back. You may
want it to compare one calibration with the next, or to explain a value on an
aircraft.

You don't need to sign in to use the card. It appears whenever the firmware has
``BARO1_THST_SCALE`` (and you are in Expert mode). When you are signed in, it
names the server it would pull logs from. The card can also read a log directly
from the connected aircraft with **Pick from vehicle**.

Configuration files go to the same place
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Once you are signed in, an **Upload to log server** button also appears next to
the export actions for **parameter backups**, **presets**, and **snapshots**.
With a tune stored next to the flights it produced, you can tell when a tune
change was followed by an oscillating flight.

Each upload opens a small form with the filename filled in from the aircraft and
the date (you can edit it) and an optional note. The folder comes from the
aircraft, the same as for a log, so both end up together. The file is sent
**exactly as exported**, byte for byte.

.. note::

   Without a log-server session the buttons are hidden, not disabled.

.. important::

   **Uploads are not private to you.** Each account uploads into its own folder,
   but the folder only decides where files land, not who may read them. Any
   signed-in user on the server can download any log or configuration file on
   it. Only the owner of a file can delete it. Treat the server as a shared
   archive for the people who hold accounts on it.

MAVLink Inspector
-----------------

The MAVLink Inspector is an **Expert-mode**, read-only view of the live decoded
MAVLink stream. Enable Expert mode to show it.

Messages are **grouped by source** (``systemId:componentId``, with a role label
such as *autopilot*, *GPS*, *gimbal*, or *GCS*). The autopilot comes first and
peripherals follow. For each message type it shows:

- **Rate** (messages/sec) and lifetime **count**
- **Bandwidth**: on-the-wire **bytes/sec**, with session totals
- A **rate sparkline** and a freshness flag. A row reads **stale** when its
  stream stops, or **slow** when its rate falls well below its recent peak
- Expandable **field tables** of the last decoded message, with a coarse type
  per field

**Link health** for each source comes from the MAVLink v2 sequence byte:
received and dropped frame counts and a **packet-loss percentage**. Frames that
arrive late within a window are not counted as loss, so the figure shows real
gaps on the link.

You can sort by name, rate, recency, or bandwidth, and filter by type or source.

A separate **Sent (outbound)** section lists the messages ArduConfigurator
itself transmits (GCS heartbeats, parameter reads/writes, message requests, and
commands) with the same per-type rate, count, and last-sent time. It fills from
traffic sent while the inspector is open, so you can check what the app put on
the wire.

Request a message
~~~~~~~~~~~~~~~~~~

The inspector can ask the autopilot for a message it is not currently sending.
Pick a message (or type any numeric id) and request it **once**
(``REQUEST_MESSAGE``) or as a **stream** at a chosen rate
(``SET_MESSAGE_INTERVAL``). You can also **disable** a stream. The result line
reports whether the autopilot accepted the request.

Live plots and export
~~~~~~~~~~~~~~~~~~~~~~

Any single numeric field can be **plotted live** over a trailing window, with an
autoscaled inline chart and a current read-out. For capture, the inspector
offers download-only **exports**:

- a **stats snapshot** (JSON) of every source and type: rates, counts, bytes,
  loss, and the last decoded fields,
- a **stream recording** (JSON): a bounded, trailing ring buffer of the most
  recent messages,
- per-plot **CSV** (``timestamp,value``) of a field's sample buffer.

DroneCAN Inspector
------------------

The DroneCAN Inspector (also Expert-mode) does for the CAN bus what the
MAVLink Inspector does for the telemetry link: live node traffic, per-node
health and parameters, ESC telemetry, and node management over the
``MAV_CMD_CAN_FORWARD`` tunnel. It has its own page, :doc:`can-dronecan`.

----

For the firmware side of logging and the protocol, see the ArduPilot wiki:
`downloading and analyzing data logs
<https://ardupilot.org/copter/docs/common-downloading-and-analyzing-data-logs-in-mission-planner.html>`__
and `MAVLink basics <https://ardupilot.org/dev/docs/mavlink-basics.html>`__.
