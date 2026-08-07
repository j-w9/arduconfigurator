Power & Battery
===============

The **Power / Battery** tab selects the battery monitor, sets pack capacity and
arming thresholds, and shows live pack telemetry. Getting the monitor right is
what makes everything downstream — the OSD readout, the remaining-capacity
estimate, and the battery failsafe — meaningful.

Battery monitor
---------------

Select the monitor type, ``BATT_MONITOR``, to match your hardware: ``0`` Disabled,
``3`` Analog Voltage Only, ``4`` Analog Voltage and Current (the usual analog
power module), ``8`` DroneCAN BatteryInfo, ``9`` ESC Telemetry, plus SMBus/INA2xx
smart-battery and many others.

.. warning::

   ``BATT_MONITOR`` is **reboot-required**. After changing the monitor type,
   reboot the flight controller and re-pull parameters so the rest of the
   ``BATT_*`` settings appear for the new backend.

Capacity & arming thresholds
----------------------------

The tab exposes the pack's ``BATT_CAPACITY`` (mAh) and two arming gates that block
arming on a depleted pack: ``BATT_ARM_VOLT`` (minimum voltage to arm) and
``BATT_ARM_MAH`` (minimum remaining capacity to arm). Edits are staged as drafts
and applied with **Apply Power Changes**.

A live readout panel shows measured voltage, current, remaining percentage, and
capacity, with a health badge — use it to sanity-check that the monitor reads a
sensible voltage before trusting calibration.

.. note::

   The analog scale factors — :param:`BATT_VOLT_MULT` (volts per pin volt),
   :param:`BATT_AMP_PERVLT` (amps per pin volt) and :param:`BATT_AMP_OFFSET`
   (the sensor's zero-current output) — are **not** edited here. They have
   guided calibration cards on the :doc:`sensors-calibration` tab, which walk
   you through comparing the flight controller against a multimeter and a clamp
   meter. If the live readout above disagrees with a meter, start there.

Low-battery failsafe
--------------------

The low/critical voltage and capacity thresholds (``BATT_LOW_VOLT``,
``BATT_CRT_VOLT``, ``BATT_LOW_MAH``, ``BATT_CRT_MAH``) and their actions
(``BATT_FS_LOW_ACT``, ``BATT_FS_CRT_ACT``) are part of the battery failsafe and
are configured on the :doc:`failsafe` tab, alongside the other failsafes — not
here. Accurate monitoring (above) is what makes those thresholds fire correctly.

For monitor wiring and the analog calibration procedure, see the ArduPilot wiki:
`Battery Monitors (Power Modules)
<https://ardupilot.org/copter/docs/common-powermodule-landingpage.html>`__.
