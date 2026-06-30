Receiver
========

The **Receiver** tab configures and verifies your RC link: which channel drives
which axis, how far each stick travels, which way each axis moves, the bind, RSSI
reporting, and flight-mode assignment. A live monitor shows the incoming channels
in real time.

.. contents:: On this page
   :local:
   :depth: 1

Live monitor
------------

The left column shows live RC input — a stick/craft preview plus per-channel
bars — so you can confirm the receiver is talking to the flight controller before
configuring anything. If it reads "No RC telemetry", the receiver isn't being
seen yet; check the serial port assignment (see :doc:`ports-serial`) and the bind.

Mapping
-------

Tells the flight controller which physical channel carries roll, pitch, throttle,
and yaw (``RCMAP_*``). Use the guided, one-axis-at-a-time mapping: move the
prompted stick and the app detects which channel responded.

Endpoints
---------

Captures the minimum, centre (trim), and maximum of each channel (``RCn_MIN`` /
``RCn_TRIM`` / ``RCn_MAX``) by moving the sticks to their extremes.

Channel direction
~~~~~~~~~~~~~~~~~~

Under Endpoints, the **Channel direction** check verifies each axis moves the
right way. Move each stick the way it's labelled — *roll right*, *pitch up*,
*throttle up*, *yaw right* — and the app reads the live channel and reports
**correct** or **backwards** for that axis.

.. note::

   Detection is reversal-aware: it reflects what ArduPilot will actually do with
   the current ``RCn_REVERSED`` setting. Pitch is the classic case — most Mode-2
   transmitters need ``RC2_REVERSED`` set so that pulling back commands pitch-up.

Any axis that reads backwards shows a one-click **Reverse** button, which stages
an ``RCn_REVERSED`` change like any other edit (apply it, then move the stick
again to confirm it now reads correct).

.. warning::

   In :doc:`../guided-setup`, the Receiver step **blocks sign-off** until every
   axis reads correct. In the regular Receiver tab this check is advisory.

Bind (ELRS / CRSF)
------------------

The **Bind RX** button (under the live monitor) puts an ExpressLRS or Crossfire
receiver into bind mode. It sends ``MAV_CMD_START_RX_PAIR``; ArduPilot forwards
the bind command to the receiver over the CRSF link. Put your transmitter / ELRS
module into bind mode at the same time — the receiver's LED confirms when it
pairs. (The flight controller does not report bind completion, so confirm at the
receiver itself.)

RSSI and flight modes
---------------------

The remaining Receiver tasks expose link-quality (RSSI) reporting as a percentage
and let you assign flight modes to a transmitter switch channel — see also
:doc:`../guided-setup` for the mode-assignment step.
