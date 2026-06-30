Logs & Inspectors
=================

After a flight, pull the onboard dataflash logs off the autopilot; during a
session, watch the live link. This page covers downloading onboard logs and the
two expert-only live inspectors — the **MAVLink Inspector** for the telemetry
stream and the **DroneCAN Inspector** for the CAN bus.

.. contents:: On this page
   :local:
   :depth: 1

Onboard logs
------------

The **Logs** tab lists the dataflash (``.BIN``) logs stored on the flight
controller and downloads them to your computer. Use **List** to enumerate them
and the per-log download button to save one, with a progress bar as it streams.

Two transports are used, transparently:

- **MAVFTP** — the preferred path when the board reports FTP support. It is a
  faster burst read and gives the real on-FC filenames. Logs are listed by
  directory; ArduPilot **hardware** serves them from ``/APM/LOGS``, while
  **SITL** serves them from ``/logs``. The app probes hardware first and falls
  through to the SITL path, so it finds the logs in either environment.
- **LOG_\*** — the classic dataflash stream (``LOG_REQUEST_LIST`` /
  ``LOG_REQUEST_DATA``), used as a fallback when MAVFTP is unavailable.

Downloaded files are given a **self-describing name** so a folder of logs from
several craft stays readable rather than a pile of ``onboard-log-1.bin``
collisions. The name encodes a board-identity tag — the autopilot's unique id
(``uid_…``) when the firmware reports a real one, else the firmware git hash
(``fw_…``), else a generic ``ardupilot`` — plus the log number and, when the FC
timestamped the log, a UTC date stamp. For example::

   uid_2300...e7_date_20240602-000000_log7.bin

.. note::

   If a download stalls at 0%, the autopilot may still consider another log
   transfer active (a lost ``LOG_REQUEST_END``, or a second ground station
   attached). The app retries — re-sending ``LOG_REQUEST_END`` first to clear
   the stuck transfer — but if it keeps failing, disconnect other ground
   stations or reboot the flight controller and try again.

MAVLink Inspector
-----------------

The MAVLink Inspector is an **Expert-mode** tool that shows the live decoded
MAVLink stream — read-only. Enable Expert mode to reveal it.

Messages are **grouped by source** (``systemId:componentId``, with a friendly
role label such as *autopilot*, *GPS*, *gimbal*, or *GCS*), so the autopilot
leads and peripherals follow. Per message type it shows:

- **Rate** (messages/sec) and lifetime **count**
- **Bandwidth** — on-the-wire **bytes/sec**, with session totals
- A **rate sparkline**, and a freshness flag — a row reads **stale** when its
  stream stops, or **slow** when its rate falls sharply off its recent peak
- Expandable **field tables** of the last decoded message, with a coarse type
  per field

**Link health** is tracked per source from the MAVLink v2 sequence byte:
received/dropped frame counts and a **packet-loss percentage**. The accounting
is reorder-tolerant — frames that arrive late within a window are recovered, not
counted as loss — so the figure reflects genuine gaps on a real link.

You can sort by name, rate, recency, or bandwidth, and filter by type or source.

Request a message
~~~~~~~~~~~~~~~~~~

The inspector can ask the autopilot for a message it is not currently sending.
Pick a message (or type any numeric id) and request it **once**
(``REQUEST_MESSAGE``) or as a **stream** at a chosen rate
(``SET_MESSAGE_INTERVAL``); you can also **disable** a stream. The result line
reports whether the autopilot accepted the request.

Live plots and export
~~~~~~~~~~~~~~~~~~~~~~

Any single numeric field can be **plotted live** over a trailing window, with an
autoscaled inline chart and a current read-out. For capture, the inspector
offers download-only **exports**:

- a **stats snapshot** (JSON) of every source and type — rates, counts, bytes,
  loss, and the last decoded fields,
- a **stream recording** (JSON) — a bounded, trailing ring buffer of the most
  recent messages,
- per-plot **CSV** (``timestamp,value``) of a field's sample buffer.

DroneCAN Inspector
------------------

The DroneCAN Inspector — also Expert-mode — does for the CAN bus what the
MAVLink Inspector does for the telemetry link: live node traffic, per-node
health and parameters, ESC telemetry, and node management over the
``MAV_CMD_CAN_FORWARD`` tunnel. It has its own page; see :doc:`can-dronecan`.

----

On the firmware side, the ArduPilot wiki is canonical for logging and the
protocol:
`downloading and analyzing data logs
<https://ardupilot.org/copter/docs/common-downloading-and-analyzing-data-logs-in-mission-planner.html>`__
and `MAVLink basics <https://ardupilot.org/dev/docs/mavlink-basics.html>`__.
