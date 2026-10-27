Failsafe
========

The **Failsafe** tab sets what the vehicle does when something goes wrong: the
RC link drops, the battery runs low, or the ground station stops talking. Each
failsafe is a small set of ArduPilot parameters.

The tab has one **sub-tab per kind of failsafe**: **RC** · **Battery** ·
**Fence** · **GCS** · **EKF** · **Advanced**. You set up one behaviour at a
time. Status summaries for RC and battery stay above the tabs. **Save
Failsafe** is global to the tab. It applies every staged change across the
sub-tabs in one press. A dot marks any tab holding an unsaved edit.

.. warning::

   **Test every failsafe on the bench with the props off.** A misconfigured
   failsafe (wrong threshold, wrong action, or an RC failsafe value that never
   triggers) is worse than none, because you will only find out in the air.
   Configure it here, then provoke each condition on the ground (switch the
   transmitter off, simulate a low cell voltage, kill the GCS link). Confirm the
   vehicle reacts the way you expect before you fly.

RC (throttle) failsafe
----------------------

The RC failsafe triggers when the receiver reports loss of signal. The receiver
signals this to the flight controller as a throttle channel value below a set
threshold.

- ``FS_THR_ENABLE``: enables the failsafe and chooses the action. The app
  shows the options as *Disabled*, *Always RTL*, *Always Land*,
  *SmartRTL or RTL*, *SmartRTL or Land*, *Auto DO_LAND_START or RTL*, and
  *Brake or Land*.
- ``FS_THR_VALUE``: the throttle PWM (in microseconds) below which the failsafe
  fires. The status card reads *Triggers below N us throttle PWM*. Set it at
  least 10 µs above the throttle value your receiver outputs when the
  transmitter is off, and above 910 µs.
- ``RC_FS_TIMEOUT``: how long (seconds) the signal must be lost before the
  failsafe is declared.

.. note::

   For the RC failsafe to work, the receiver must drop the throttle channel low
   (or stop outputting) when the transmitter is off. Configure a "no-pulse" or
   low-throttle failsafe on the receiver itself. Check the receiver behaviour
   and the throttle channel reading on the :doc:`receiver` tab first.

Battery failsafe
----------------

The battery failsafe watches pack voltage and consumed capacity against two
tiers of threshold, *low* and *critical*, each with its own action. It only
appears once a battery monitor is configured. If ``BATT_MONITOR`` is 0 the tab
shows a single notice pointing you to :doc:`power-battery` (Config ▸ Power) to
enable it.

Low tier:

- ``BATT_LOW_VOLT``: voltage that triggers the low failsafe (volts). The
  ArduPilot default is 10.5 V (a 3S threshold). Set it for your cell count.
- ``BATT_LOW_MAH``: consumed-capacity trigger (mAh remaining). About 20% of
  pack capacity is a sensible value. 0 disables the capacity trigger.
- ``BATT_FS_LOW_ACT``: the action.

Critical tier (a more aggressive fallback):

- ``BATT_CRT_VOLT``: critical voltage threshold (0 disables).
- ``BATT_CRT_MAH``: critical capacity threshold (0 disables).
- ``BATT_FS_CRT_ACT``: the action.

Both action parameters share the same options, shown in the app as: *None*,
*Land*, *RTL*, *SmartRTL or RTL*, *SmartRTL or Land*, *Terminate*,
*Auto DO_LAND_START or RTL*, and *Brake or Land*. A common setup is
``BATT_FS_LOW_ACT`` = *RTL* with ``BATT_FS_CRT_ACT`` = *Land*.

.. warning::

   *Terminate* disarms the motors immediately and the vehicle falls out of the
   sky. Only choose it if you understand the consequence (for example, a
   parachute is fitted). It is never a safe default for a multirotor.

The app also shows ``BATT_FS_VOLTSRC`` (whether the threshold compares against
raw or sag-compensated voltage). Other battery settings such as
``BATT_LOW_TIMER`` are in the **Additional failsafe settings** card. You can
also edit the same voltage and capacity thresholds on :doc:`power-battery`
(Config ▸ Power). Both tabs share one staged-write model.

Geofence
--------

The fence has its own **Fence** sub-tab. The **Geofence** card sets the boundary
the vehicle may fly inside and what happens when it reaches it. A fence is a
failsafe too: a condition that triggers an action.

- ``FENCE_ENABLE``: whether the fence is active at all. It can also be toggled
  from an RC switch or over MAVLink, but those changes are not saved.
- ``FENCE_TYPE``: which limits are active, as independent checkboxes: max
  altitude, a circle centred on home, inclusion/exclusion polygons, and a
  minimum altitude. The max-altitude, circle and polygon fences take effect as
  soon as they are configured. The minimum-altitude fence only arms once the
  vehicle has climbed through it, so it cannot fire on the ground.
- ``FENCE_ACTION``: what a breach does: report only, RTL or Land, always Land,
  SmartRTL variants, or Brake or Land.
- ``FENCE_RADIUS`` / ``FENCE_ALT_MAX`` / ``FENCE_ALT_MIN``: the boundaries,
  in metres.
- ``FENCE_MARGIN``: how far the autopilot keeps from the fence to avoid
  breaching it.
- ``FENCE_AUTOENABLE``: whether fences arm themselves automatically.

.. note::

   ``FENCE_TOTAL`` is not offered as a field. ArduPilot's own description says
   not to change it by hand. It counts the stored polygon points, and editing it
   corrupts them.

GCS, EKF, and advanced failsafes
--------------------------------

- ``FS_GCS_ENABLE``: the ground-station failsafe. If no MAVLink heartbeat
  arrives from the GCS for ``FS_GCS_TIMEOUT`` seconds (default 5), the chosen
  action runs. The app shows *Disabled*, *Always RTL*, *SmartRTL or RTL*,
  *SmartRTL or Land*, *Always Land*, *Auto DO_LAND_START or RTL*, and
  *Brake or Land*. Leave this **Disabled** unless you fly with a companion
  computer or a telemetry link you depend on. Otherwise a routine USB
  disconnect can trigger it.
- ``FS_EKF_ACTION`` / ``FS_EKF_THRESH``: what to do, and how sensitive to be,
  when the EKF position/attitude estimate becomes unreliable (*Report Only*,
  *Land*, *AltHold*, or *Land Even In Stabilize*).
- ``FS_OPTIONS``: a bitmask of refinements such as continuing an Auto mission
  through an RC failsafe or releasing a gripper on failsafe.

Editing and saving
-------------------

Each card has an inline editor: a dropdown for the action/enable parameters and
a number field for thresholds. Edits stage as drafts, as on the other parameter
tabs, and a footer shows the staged and invalid counts. **Save Failsafe** writes
them with verified ``PARAM_SET`` → ``PARAM_VALUE`` confirmation, and **Revert**
discards them. The **Additional failsafe settings** card below holds any other
metadata-backed failsafe parameters (advanced battery, EKF, and pre-arm options)
not already shown above.

.. note::

   Failsafe rows and labels depend on the vehicle. On ArduPlane, ArduRover, and
   ArduSub the tab shows that vehicle's own failsafe parameters
   (``THR_FAILSAFE`` / ``FS_LONG_ACTN`` on Plane, ``FS_ACTION`` on Rover,
   ``FS_LEAK_ENABLE`` / ``FS_PRESS_ENABLE`` on Sub, and so on). ArduCopter is the
   validated path.

See also the ArduPilot wiki: `Radio Failsafe
<https://ardupilot.org/copter/docs/radio-failsafe.html>`_, `Battery Failsafe
<https://ardupilot.org/copter/docs/failsafe-battery.html>`_, and `GCS Failsafe
<https://ardupilot.org/copter/docs/gcs-failsafe.html>`_.
