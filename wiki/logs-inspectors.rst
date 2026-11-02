Logs & Inspectors
=================

This page covers the **Logs** tab (what the vehicle logs, and downloading it)
and the Expert-mode **MAVLink Inspector** for the live telemetry stream. The CAN
bus has its own page, :doc:`can-dronecan`.

What gets logged
----------------

Logging is configured at the top of the **Logs** tab.

**Edit log configuration** holds these settings:

- the backend (``LOG_BACKEND_TYPE``: *None*, *File*, *MAVLink*,
  *File + MAVLink*, *Block*);
- the SD-card reserve (``LOG_FILE_MB_FREE``);
- *Rotate Log on Disarm* (``LOG_FILE_DSRMROT``);
- replay logging (``LOG_REPLAY``);
- *Log While Disarmed* (``LOG_DISARMED``);
- the **Log Bitmask** (``LOG_BITMASK``) as named checkboxes: *Fast attitude*,
  *GPS*, *Control tuning*, *RC input*, *IMU*, *Raw IMU*, and the rest.

**Logging for tuning** sets up the log a tuning flight needs in one click. **Log
Tuning** and notch placement work from the IMU batch sampler (high-rate gyro
samples). The sampler is off by default and depends on more than one parameter.
**Set up for a tuning flight** stages them all: the batch mask
(``INS_LOG_BAT_MASK``, first IMU), pre-filter sampling (``INS_LOG_BAT_OPT``),
and the *Raw IMU* log bit that Copter requires for the sampler. The badge reads
*ready* once the log will carry raw IMU samples, or *n to set* with the
remaining steps named. The individual fields are below the button:

- the batch mask;
- **Fast sampling (IMU mask)** (``INS_FAST_SAMPLE``, the same field as
  Setup › System). A tuning log needs the sampled IMU at gyro rate;
- the sampler options, count, interval and push rate.

Most of these take effect after a reboot, and the card tells you so.

Both cards stage drafts. **Save Logs (n)** writes them and **Revert** discards
them.

Onboard logs
------------

The **Onboard logs** card lists the dataflash (``.BIN``) logs stored on the
flight controller and downloads them to your computer. **List onboard logs**
lists them. **Download .bin** saves one, with a progress bar as it streams.
**Clear logs** erases every log on the card after you confirm.

The app reads logs in one of two ways and picks for you:

- **MAVFTP**: tried first, whatever the board advertises. It reads the real
  directory, is faster, and gives the on-FC filenames. Hardware serves logs
  from ``/APM/LOGS`` and SITL from ``/logs``. The app tries the hardware path
  first.
- **LOG_\***: the classic dataflash stream (``LOG_REQUEST_LIST`` /
  ``LOG_REQUEST_DATA``), used only when MAVFTP cannot answer.

.. note::

   This order matters after an **erase**. The ``LOG_*`` list comes from
   ``LASTLOG.TXT``, which ArduPilot removes only at the end of the erase
   (``AP_Logger_File::erase_next``). Until then, or for good if the erase is
   interrupted, an FC can list logs that are no longer on the card, and the
   stale number survives a reconnect. Because the app reads the directory, the
   Logs and **Files** tabs always describe the same card. If another GCS still
   shows the old logs, it is reading ``LASTLOG.TXT``.

Downloaded files are named so that a folder of logs from several craft stays
readable. The name has a board tag (the autopilot's unique id ``uid_…``, else
the firmware git hash ``fw_…``, else ``ardupilot``), the log number, and a UTC
date when the FC timestamped the log. For example::

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

The **Baro thrust (VALT)** card takes a flight log as its only input, so keep
that log where you can get it back. You may want it to compare one calibration
with the next, or to explain a value on an aircraft. You don't need to sign in.
The card appears whenever the firmware has ``BARO1_THST_SCALE`` and Expert mode
is on. When you are signed in, it names the server it would pull from.

Configuration files go to the same place
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Once you are signed in, an **Upload to log server** button also appears next to
the export actions for **parameter backups**, **presets**, and **snapshots**.
With a tune stored next to the flights it produced, you can tell when a tune
change was followed by an oscillating flight.

Each upload opens a form with the filename filled in from the aircraft and date
(you can edit it) and an optional note. The folder comes from the aircraft, the
same as for a log, so both end up together. The file is sent exactly as
exported.

.. note::

   Without a log-server session the buttons are hidden, not disabled.

.. important::

   **Uploads are not private.** Every signed-in user on the server can download
   any log or configuration file on it. Only the owner can delete one. Treat the
   server as a shared archive for its account holders.

MAVLink Inspector
-----------------

The MAVLink Inspector is an Expert-mode, read-only view of the live decoded
MAVLink stream. It decodes every message in ArduPilot's dialect. It has two
sub-tabs, **Messages** and **Plot**, described below.

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
received and dropped frame counts and a packet-loss percentage. Frames that
arrive late within a window are not counted as loss, so the figure shows real
gaps.

You can sort by name, rate, recency, or bandwidth, and filter by type or source.

A **Sent (outbound)** section lists what the app itself transmits (GCS
heartbeats, parameter reads/writes, message requests, commands) with the same
rate, count and last-sent time. It fills from traffic sent while the inspector
is open.

Request a message
~~~~~~~~~~~~~~~~~~

The inspector can ask the autopilot for a message it is not currently sending.
Pick a message (or type any numeric id), then click **Request once**
(``REQUEST_MESSAGE``) or **Set stream** at a chosen rate
(``SET_MESSAGE_INTERVAL``). **Disable** stops a stream. The result line reports
whether the autopilot accepted the request. If a graph on the Plot tab needs a
message the vehicle is not sending, you can request the stream from there the
same way.

Recording and export
~~~~~~~~~~~~~~~~~~~~

**Record stream** / **Stop recording** keeps a trailing buffer of recent
messages, and **Download capture** saves it as JSON. **Export JSON** writes a
stats snapshot of every source and type: rates, counts, bytes, loss and the last
decoded fields. **Pause** freezes the table. **Clear** resets the counts.

Plot
~~~~

The **Plot** sub-tab is the live plot workspace, shared with the CAN tab. It is
laid out like PlotJuggler and MAVExplorer: charts on the left, and an **Add**
panel on the right with three tabs.

- **Fields** lists every message the vehicle is sending, with its rate. **+**
  adds a numeric field as a line. Click a line's swatch to hide it.
- **Expression** plots arithmetic over fields (``MESSAGE.field``), with
  per-line transforms.
- **Graphs** holds MAVExplorer's ready-made graphs, live.

Each chart has a toolbar: the trailing window (**10 s** / **20 s** / **60 s**),
**Pause**, **Overlay all** / **Split all**, **Stats**, **Flight modes** (mode
bands on the time axis), **Param changes** (markers where a parameter was
written), **Save**, **Export CSV** (``timestamp,value``) and **Clear all**.
Lines of very different size get separate value axes. The chart menu adds an
FFT view, a histogram, a typed value range, XY charts and *Only when*
conditions. Where the cursor is off a line's data, the latest value shows
dimmed.

The CAN bus
-----------

The DroneCAN Inspector is part of the **CAN** tab, which has a per-device
pop-out window. See :doc:`can-dronecan`.

----

For the firmware side of logging and the protocol, see the ArduPilot wiki:
`downloading and analyzing data logs
<https://ardupilot.org/copter/docs/common-downloading-and-analyzing-data-logs-in-mission-planner.html>`__
and `MAVLink basics <https://ardupilot.org/dev/docs/mavlink-basics.html>`__.
