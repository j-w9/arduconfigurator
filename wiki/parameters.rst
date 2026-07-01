Parameters (Expert)
===================

The **Parameters** tab is the raw parameter editor — the full ArduPilot
parameter tree with search, inline editing, staged drafts, verified writes, and
import/export. It is an **Expert** surface: the product-shaped tabs (Setup,
Ports, Receiver, Outputs, Power, Tuning) cover routine workflow changes more
safely, so reach for this tab when you need a parameter those surfaces do not
expose, or when you are migrating a configuration between aircraft.

.. contents:: On this page
   :local:
   :depth: 1

Browsing, search, and categories
---------------------------------

The table lists every parameter the connected flight controller reports,
enriched with labels, descriptions, units, ranges, and categories from the
metadata catalog, which is firmware-version-aware — a 4.7 (or newer) controller
gets the 4.7 labels, ranges, and enum values, while older firmware and the
pre-connect view keep the stable set, so each value's options and limits match
the running firmware. A **search** box filters by name with wildcards (for example
``ARMING_*`` or ``*VOLT*``), and a **category** dropdown narrows to a single
group such as rangefinder, gimbal, or serial. A **Refresh** button pulls the
tree fresh from the controller, bypassing the auto-refresh, and selecting any
row opens a detail card with the parameter's description, range/step, and whether
it is reboot-required.

Editing and staged drafts
-------------------------

Editing a value does not write it immediately — it stages a local **draft**.
Drafts are reviewed as a grouped diff (current → new, with the delta) before
anything reaches the aircraft, and each draft is classified as **staged** or
**invalid** (out of range, or outside the known enum values). Apply a single row
with its **Apply** button, or write the whole set with **Apply All**.

Writes use the verified ``PARAM_SET`` → ``PARAM_VALUE`` path: each value is sent
and then confirmed against the controller's read-back within a tolerance. A
batch (Apply All) write can roll back already-applied changes if a later write
fails, so a partial failure does not silently leave a half-applied set.

.. note::

   An invalid draft blocks **Apply All** until it is fixed or dropped. When the
   metadata's documented range or enum lags the firmware (a legitimately new
   value the running firmware accepts), an **Override and write anyway** button
   lets that specific value through. Non-numeric input stays hard-invalid.

.. warning::

   Apply All is blocked while an accelerometer or compass calibration is running
   — the app surfaces the reason before you click. Some parameters are
   reboot-required: applying them flags a prompt to reboot and re-read the tree
   before continuing.

Import and export
-----------------

The tab reads and writes three file formats:

- **ArduConfigurator JSON** — a full backup with metadata and the captured
  hardware/firmware identity; round-trips back through Import.
- **Mission Planner .param / .parm** — ``NAME,VALUE`` per line.
- **QGroundControl .params** — tab-separated ``vid/cid/NAME/VALUE/type``.

Importing a backup stages the differing values as drafts and scrolls the diff
into view — nothing is written until you review it and click Apply All. Optional
**Skip on import** toggles drop calibration offsets, the ``SRn_*`` stream-rate
group, or the ``MIS_*`` mission parameters before staging.

Exporting mirrors that with **Skip on export** toggles, so you can leave the
per-airframe or volatile categories out of the file for a leaner, more portable
backup: calibration offsets/scales/trims (skipped by default), the ``SRn_*``
stream-rate group, or the ``MIS_*`` mission parameters. The success notice reports
what was skipped. Volatile system values the firmware continuously re-derives are
always excluded.

.. note::

   Internal-use-only parameters such as ``BAROn_GND_PRESS`` are dropped on import
   unconditionally — the firmware owns and continuously re-derives that value, so
   a verified write could never confirm. Imports also flag a **firmware-version
   mismatch** (for example a 4.6 backup onto 4.7 firmware) and a cross-vehicle or
   cross-board migration, because parameters are renamed, added, or removed
   between releases and only those that exist on the connected firmware are
   applied. Review the staged diff before applying.

Backups, presets, and snapshots
--------------------------------

Beyond ad-hoc file export, the app keeps configuration in three reusable forms,
all of which stage drafts through the same verified write path:

- **Backups** — the JSON/.param/.params files above; the durable, portable
  record of a configuration.
- **Snapshots** — full parameter-tree captures stored in a local library, with
  labels, notes, tags, and deletion protection, captured from the live tree or
  imported from a backup. Use these to checkpoint a known-good state before a
  risky change.
- **Presets** — curated bundles of desired values that diff against the live
  tree and stage only what differs, with an applicability check so a preset that
  does not fit the current firmware/vehicle is flagged rather than applied
  blindly.

For the complete list of every parameter and its meaning, see the ArduPilot
`Complete Parameter List
<https://ardupilot.org/copter/docs/parameters.html>`__.
