Power & Battery
===============

Battery setup lives under **Config ▸ Power**. It selects the battery monitor,
sets pack capacity and arming thresholds, and shows live pack telemetry. It has
its own Apply for the battery parameters. The OSD readout, the
remaining-capacity estimate and the battery failsafe all depend on the monitor
being set up correctly.

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
capacity, with a health badge. Check that the monitor reads a sensible voltage
before you trust the calibration.

.. note::

   The analog scale factors are **not** edited here: :param:`BATT_VOLT_MULT`
   (volts per pin volt), :param:`BATT_AMP_PERVLT` (amps per pin volt) and
   :param:`BATT_AMP_OFFSET` (the sensor's zero-current output). They have
   guided calibration cards on the :doc:`sensors-calibration` tab, which take
   you through comparing the flight controller against a multimeter and a clamp
   meter. If the live readout above disagrees with a meter, start there.

Low-battery failsafe
--------------------

The low/critical voltage and capacity thresholds (``BATT_LOW_VOLT``,
``BATT_CRT_VOLT``, ``BATT_LOW_MAH``, ``BATT_CRT_MAH``) and their actions
(``BATT_FS_LOW_ACT``, ``BATT_FS_CRT_ACT``) are part of the battery failsafe.
Set them on the :doc:`failsafe` tab, with the other failsafes. Those thresholds
only fire correctly if the monitoring above is accurate.

For monitor wiring and the analog calibration procedure, see the ArduPilot wiki:
`Battery Monitors (Power Modules)
<https://ardupilot.org/copter/docs/common-powermodule-landingpage.html>`__.
