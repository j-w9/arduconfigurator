Parameters (Expert)
===================

The **Parameters** tab is the raw parameter editor. It shows the full ArduPilot
parameter tree with search, inline editing, staged drafts, verified writes, and
import/export. It is an **Expert** tab. The other tabs (Setup,
:doc:`Config <config>`, Ports, Receiver, Outputs, Power, Tuning) cover routine
changes more safely. Use this one for a parameter they do not expose, or when
you move a configuration between aircraft.

Browsing, search, and categories
---------------------------------

The table lists every parameter the connected flight controller reports. Labels,
descriptions, units, ranges, and categories come from the metadata catalog,
which follows the firmware version. A 4.7 (or newer) controller gets the 4.7
labels, ranges, and enum values. Older firmware and the pre-connect view use the
stable set. Each value's options and limits match the running firmware. The
**search** box is pinned to the top of the editor, so it stays in reach while
you scroll. It filters by name with wildcards (for example ``ARMING_*`` or
``*VOLT*``). The **category** dropdown narrows the table to one group, such as
rangefinder, gimbal, or serial.

Without wildcards the search is **fuzzy**. It matches names and labels whose
letters appear in the order you typed them, best match first. This helps when
you half-remember a name. When you know the name, it can get in the way:
searching ``FS_THR`` also finds ``FS_EKF_THRESH``. Tick **Exact match** to show
only rows that contain exactly what you typed, in the controller's own order. A
wildcard search is always literal, so the box makes no difference to
``ARMING_*``. **Refresh** pulls the tree fresh from the controller, bypassing
the auto-refresh. Each row is compact (name, current value, and the draft
editor), so more of the tree fits on screen.

Looking parameters up with nothing connected
--------------------------------------------

The table needs a flight controller, but reading about a parameter does not.
With no vehicle attached, the search box searches the **built-in reference**:
every parameter the metadata bundle knows about, with its label, description,
unit, documented range and, for an enum, what each value means. Wildcards, fuzzy
matching and **Exact match** work the same as when connected.

The reference is read-only. There are no current values, drafts, or editors.
Long result sets show the first hundred and tell you how many were left out.

Expanding a row for detail
--------------------------

Click a row to **expand it in place**. The expanded panel shows the full
metadata for that parameter:

- the friendly **label**, full **description**, **unit**, and documented
  **range**;
- the parameter's **old / renamed name**, when ArduPilot has renamed it (for
  example ``GPS_TYPE`` is *also known as* ``GPS1_TYPE``, and ``MAV_SYSID`` shows
  its *old name* ``SYSID_THISMAV``). Use it to search the ArduPilot wiki or an
  older configuration;
- for an **enum**, what the current value **means** (for example ``9 —
  DroneCAN``); and
- a fuller editor: type a raw **Value**, **or** pick a named option from the
  enum **dropdown**. Both edit the same draft. Bitmask parameters show a grid of
  checkboxes, one per bit, each labelled with its meaning.

Click the row again to collapse it.

Editing and staged drafts
-------------------------

Editing a value does not write it. It stages a local **draft**. You review
drafts as a grouped diff (current → new, with the delta) before anything reaches
the aircraft. Each draft is marked **staged** or **invalid** (out of range, or
outside the known enum values). If you edit a row back to its live value, it
stays in the review as a muted "matches current — won't write" entry until you
**Drop** it, so rows don't vanish while you edit. Apply one row with its
**Apply** button, or write the whole set with **Apply All**.

Writes use the verified ``PARAM_SET`` → ``PARAM_VALUE`` path. Each value is sent
and then checked against the controller's read-back, within a tolerance. If a
later write in an Apply All batch fails, the app can roll back the changes it
already applied, so a failure does not leave a half-applied set.

.. note::

   An invalid draft blocks **Apply All** until you fix or drop it. Sometimes the
   metadata's documented range or enum lags the firmware, and the running
   firmware accepts a newer value. For that case, an **Override and write
   anyway** button lets that one value through. Non-numeric input is always
   invalid.

.. warning::

   Apply All is blocked while an accelerometer or compass calibration is
   running. The app tells you why before you click. Some parameters need a
   reboot: applying them shows a prompt to reboot and re-read the tree before
   you continue.

Import and export
-----------------

The tab reads and writes three file formats:

- **ArduConfigurator JSON:** a full backup with metadata and the captured
  hardware/firmware identity. Import reads it back.
- **Mission Planner .param / .parm:** ``NAME,VALUE`` per line.
- **QGroundControl .params:** tab-separated ``vid/cid/NAME/VALUE/type``.

Importing a backup stages the values that differ as drafts and scrolls the diff
into view. Nothing is written until you review it and click Apply All. Optional
**Skip on import** toggles leave out calibration offsets, the ``SRn_*`` stream-rate
group, or the ``MIS_*`` mission parameters before staging.

Export has matching **Skip on export** toggles. Use them to leave per-airframe
or volatile categories out of the file, for a smaller, more portable backup:
calibration offsets/scales/trims (skipped by default), the ``SRn_*`` stream-rate
group, or the ``MIS_*`` mission parameters. The success notice lists what was
skipped. Volatile system values that the firmware keeps re-deriving are always
excluded.

.. note::

   Internal-use-only parameters such as ``BAROn_GND_PRESS`` are always dropped
   on import. The firmware owns that value and keeps re-deriving it, so a
   verified write could never confirm. Imports also flag a **firmware-version
   mismatch** (for example a 4.6 backup onto 4.7 firmware) and a cross-vehicle
   or cross-board migration. Parameters are renamed, added, or removed between
   releases, and only those that exist on the connected firmware are applied.
   Review the staged diff before applying.

Backups, presets, and snapshots
--------------------------------

Besides file export, the app keeps configuration in three reusable forms. All
of them stage drafts through the same verified write path:

- **Backups:** the JSON/.param/.params files above. This is the portable,
  long-term record of a configuration.
- **Snapshots:** full parameter-tree captures stored in a local library, with
  labels, notes, tags, and deletion protection, captured from the live tree or
  imported from a backup. Use them to save a known-good state before a risky
  change.

  To change a saved snapshot's label, tags or note, select it and press
  **Edit Details**. This changes the description only. The captured values and
  the entry's place in the library stay the same. To replace the captured
  values, use **Overwrite Selected**.

  A restore can include the calibration values (accelerometer, compass, RC trim)
  or leave them out. They are excluded by default, and the option to include
  them is **Expert-only**. Those values describe the hardware they were measured
  on, so importing them onto a different board means flying on another unit's
  measurements.
- **Presets:** curated bundles of values. A preset is diffed against the live
  tree and stages only what differs. An applicability check flags a preset that
  does not fit the current firmware/vehicle instead of applying it.

For the complete list of every parameter and its meaning, see the ArduPilot
`Complete Parameter List
<https://ardupilot.org/copter/docs/parameters.html>`__.

.. note::

   Snapshots, presets and tuning profiles are stored in **this browser**, not on
   a server or on the aircraft. Clearing site data removes them. Export a library
   (or upload it to a log server) to keep a copy.
