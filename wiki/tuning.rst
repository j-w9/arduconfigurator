Tuning
======

The **Tuning** tab is a product-shaped front end for ArduCopter's attitude
controllers. It groups the stick feel, rate gains, and filters that an operator
actually adjusts into curated cards — backed by real ArduPilot parameters — so a
tune can be roughed in without diving into the raw parameter tree. Every change
is staged as a local draft and reviewed before it is written to the controller,
and known-good tunes can be saved as reusable profiles.

The tab is split into eight tasks: **Pilot**, **PID Gains**, **Filters**,
**Autotune**, **Profiles**, **Review**, **Initial Tune**, and **Log Tuning**. The workspace is
full-width — each task fills it — and every control carries an **"i" info bubble** with the
parameter's plain-text description, its label, and its unit, so guidance is one
hover away rather than a wall of text on the page.

Pilot
-----

The **Pilot** task groups everything that shapes how manual flight *feels* but
is **not** a PID gain — stick response, limits, and the pilot-facing speeds of
the assisted modes. It is organised into four cards.

**Angle** — self-levelling (Stabilize/AltHold) feel:

- ``ATC_INPUT_TC`` — stick input smoothing / time constant.
- ``ATC_ANGLE_MAX`` (or the legacy ``ANGLE_MAX`` in centidegrees) — maximum lean
  angle.
- ``PILOT_Y_RATE`` / ``PILOT_Y_EXPO`` — yaw authority and centre softening.

**Attitude (Acro)** — the acro-style rate shaping that sits above the rate
controllers:

- ``ACRO_RP_RATE`` / ``ACRO_Y_RATE`` — maximum roll/pitch and yaw rotation rates.
- ``ACRO_RP_EXPO`` / ``ACRO_Y_EXPO`` — expo, which softens the centre without
  reducing full-stick authority.
- ``ATC_ACCEL_R_MAX`` / ``ATC_ACCEL_P_MAX`` / ``ATC_ACCEL_Y_MAX`` (4.5+ uses the
  degrees-based ``ATC_ACC_*_MAX``) — angular-acceleration limits that bound how
  aggressively the controller chases a commanded rate.

**Alt Hold** — the vertical-speed feel of the assisted modes:

- ``PILOT_SPEED_UP`` / ``PILOT_SPEED_DN`` (4.6+ uses the SI ``PILOT_SPD_UP`` /
  ``PILOT_SPD_DN``) — commanded climb and descent speed.
- ``PILOT_ACCEL_Z`` (4.6+ ``PILOT_ACC_Z``) — vertical acceleration.
- ``PILOT_THR_FILT`` — throttle input filtering.
- ``THR_DZ`` — throttle deadzone around the hover point.
- ``PILOT_TKOFF_ALT`` (4.6+ ``PILOT_TKO_ALT_M``) — auto-takeoff target altitude.

**Loiter** — position-hold feel:

- ``LOIT_SPEED`` — maximum horizontal speed.
- ``LOIT_ACC_MAX`` — maximum acceleration.
- ``LOIT_ANG_MAX`` — maximum lean angle in Loiter.
- ``LOIT_BRK_ACCEL`` / ``LOIT_BRK_DELAY`` / ``LOIT_BRK_JERK`` — the braking
  response when the sticks return to centre (and their 4.6+ SI renames).

The view drops any parameter the connected firmware does not stream, so only the
form your firmware version uses is shown.

Rate controllers (PID gains)
----------------------------

The **PID Gains** task exposes the per-axis rate controllers — the innermost
loop that turns a demanded rotation rate into motor output. Roll, pitch, and yaw
each get P, I, D, and feedforward controls, grouped by axis:

- ``ATC_RAT_RLL_P`` / ``ATC_RAT_RLL_I`` / ``ATC_RAT_RLL_D`` / ``ATC_RAT_RLL_FF``
- ``ATC_RAT_PIT_P`` / ``ATC_RAT_PIT_I`` / ``ATC_RAT_PIT_D`` / ``ATC_RAT_PIT_FF``
- ``ATC_RAT_YAW_P`` / ``ATC_RAT_YAW_I`` / ``ATC_RAT_YAW_D`` / ``ATC_RAT_YAW_FF``

A **roll/pitch link** keeps the two axes coupled while you rough in a baseline,
to be unlinked only if the airframe needs a deliberate asymmetry. **Grouped
master sliders** scale P+I, D, feedforward, the pitch ratio, and filter
frequency together, previewing exactly which parameters will move before you
stage the whole set at once. Deeper controller terms — D-term feedforward
(``ATC_RAT_*_D_FF``), integrator clamps (``ATC_RAT_*_IMAX``), PD ceilings
(``ATC_RAT_*_PDMX``), and slew limits (``ATC_RAT_*_SMAX``) — stay behind an
*Advanced terms* foldout so the baseline pass stays clean.

.. note::

   Feedforward increases stick-to-rate immediacy; use it deliberately rather
   than masking a weak base tune. If you move P, I, or D significantly, re-check
   the filters and do a short test flight before stacking more changes.

Filters
-------

The **Filters** task holds every filter parameter, so a noise-handling pass is
one deliberate change in one place: the gyro and accelerometer filters, the nine
rate-loop filters, and the harmonic notch.

Each rate axis exposes a target, error, and D-term filter frequency:

- ``ATC_RAT_RLL_FLTT`` / ``ATC_RAT_RLL_FLTE`` / ``ATC_RAT_RLL_FLTD``
- ``ATC_RAT_PIT_FLTT`` / ``ATC_RAT_PIT_FLTE`` / ``ATC_RAT_PIT_FLTD``
- ``ATC_RAT_YAW_FLTT`` / ``ATC_RAT_YAW_FLTE`` / ``ATC_RAT_YAW_FLTD``

Higher frequencies preserve response but pass more noise; lower values smooth
noise at the cost of latency. Zero is valid for some of these and intentionally
disables that filter path.

The sensor-side filters (``INS_GYRO_FILTER``, ``INS_ACCEL_FILTER``) and the
harmonic notch sit in the same grid. These were briefly a second *Filter
Editor* tab, which meant two Tuning tabs both called filters, editing
overlapping parameters in two different layouts.

Set filters from the gyro cutoff
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Enter the gyro cutoff you want and the tab fills in the filter set ArduPilot
derives from it. Every proposal is editable before anything is staged, and
staging goes through the normal draft path — the values land in the fields
above, show as staged, and are written by the same reviewed **Apply** as any
other edit. Nothing is written to the vehicle by this panel.

The ratios are ArduPilot's own:

- ``ATC_RAT_RLL_FLTD`` and ``ATC_RAT_PIT_FLTD`` — the gyro cutoff **halved**;
  ``ATC_RAT_YAW_FLTD`` — a **quarter** of it. ArduPilot's *Aggressive Rate Loop
  Tuning* page: *"each axis' ATC_RAT_xxx_FLTD should be INS_GYRO_FILTER/2 on
  roll and pitch and INS_GYRO_FILTER/4 on yaw"*. Yaw is filtered harder because
  D is the most active term, passes the most noise, and is the one that heats
  motors.
- ``ATC_RAT_RLL_FLTT`` / ``ATC_RAT_PIT_FLTT`` / ``ATC_RAT_YAW_FLTT`` — the
  cutoff halved, and ``ATC_RAT_YAW_FLTE`` a fixed 2 Hz, from *Setting the
  Aircraft Up for Tuning*.
- The cutoff itself, for which that same page gives starting points by prop
  size — 80 Hz for 5-inch, 40 Hz for 10-inch, 20 Hz for 20-inch and larger.
  They are offered as buttons; the app cannot see what is bolted to the frame.

Roll and pitch ``FLTE`` are deliberately **not** proposed. Mission Planner
zeroes them, ArduPilot's pages do not say to, and a value this app invented has
no business being staged to a flight controller.

A D-term filter edited above **0.75 × the gyro cutoff** is called out inline —
ArduPilot documents that as not recommended.

Everything else is yours
~~~~~~~~~~~~~~~~~~~~~~~~

**Nothing else is derived.** Fields show what the vehicle is running, and an
untouched field stages nothing. An earlier version computed the whole rate-loop
set from the gyro filter, but those ratios come from Mission Planner's *Initial
Parameters* screen rather than from ArduPilot's own documentation, and this
surface writes to a flight controller. They are yours to set.

Each parameter gets its real editor, not a number box: ``INS_HNTCH_MODE`` is a
named list, ``INS_HNTCH_OPTS`` and ``INS_HNTCH_HMNCS`` are per-bit toggles, and
everything else is a number with the units and range the firmware declares.
Every field carries the usual **"i"** bubble naming the raw parameter, with a
link to its page in the :doc:`parameter reference <parameters>`.

Two suggestions, both documented
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The only arithmetic on the page. Each is a button that fills a field you can
then edit or ignore:

- **Bandwidth** — ``INS_HNTCH_BW`` at half the centre frequency. ArduPilot's
  parameter documentation: *"This is typically set to half the base
  frequency"*, and the throttle-based notch setup gives ``BW = hover_freq /
  2``.
- **Reference** — ``INS_HNTCH_REF``. ArduPilot documents ``1`` for RPM and
  ESC-telemetry tracking, and the hover thrust (``MOT_THST_HOVER``) for
  throttle mode. Nothing is suggested for Fixed or in-flight FFT, because the
  docs give no value for them.

.. important::

   A ``INS_HNTCH_REF`` of zero *"disables dynamic updates"*. An enabled notch
   with the reference still at zero looks configured and tracks nothing — the
   editor warns when it sees that combination.

Half-the-centre is the **throttle-mode** rule, where the frequency is inferred
from throttle position and the notch has to be wide enough to cover the error.
With a measured source — ESC telemetry, an RPM sensor, in-flight FFT — the
frequency is known and a narrower notch is usual; a 15-inch build might run
``FREQ 40`` with ``BW 10``. There is no documented ratio for those modes, so
none is offered.

Where the centre frequency comes from
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

It is a property of the motors, not of the gyro filter, so it cannot be
derived. The usual routes:

- **Post-flight FFT** — set ``INS_LOG_BAT_MASK = 1`` and ``INS_LOG_BAT_OPT =
  4``, hover, then open the log in Mission Planner (SETUP → ADVANCED → FFT →
  *IMU Batch Sample*) and read the peak at the motor rotational frequency.
  Expect roughly 200 Hz on a small copter, nearer 100 Hz on a large one.
- **ESC telemetry** (``INS_HNTCH_MODE`` 3) or an **RPM sensor** (2 or 5) — the
  autopilot reads RPM directly, and ``INS_HNTCH_FREQ`` becomes the lower limit
  the tracked notch will not go below.
- **In-flight FFT** (mode 4) — the autopilot runs its own FFT; ArduPilot calls
  it *"probably the best mode if the autopilot is capable"*, and it needs an
  H7 or F7 board.
- **Throttle** (mode 1) — hover frequency from a log, scaled by throttle.
  ``MOT_HOVER_LEARN = 2`` learns the hover thrust for the reference.

``INS_HNTCH_OPTS`` is editable and decoded as you type, so a bitmask reads back
as names — ``22`` is *Multi-Source, Update at loop rate, Triple notch*.

Like every other tuning surface, it stages drafts; nothing is written until you
apply them in **Review**.

Autotune
--------

**AutoTune** is an ArduPilot flight mode that flies the aircraft through small
test motions to discover rate and angle gains automatically. It is a good
starting point when you have no baseline. The **Autotune** task is where you
configure the run before you take off — it does not tune on the bench:

- ``AUTOTUNE_AXES`` — which axes to tune (roll, pitch, yaw, or a combination).
- ``AUTOTUNE_AGGR`` — tuning aggressiveness; higher values chase a tighter,
  more responsive tune.
- ``AUTOTUNE_MIN_D`` — a floor on the discovered D term.
- ``AUTOTUNE_GMBK`` — gimbal/gain-backoff behaviour for the run.

Set these here, stage and write them like any other change, then switch to the
AutoTune flight mode in the air and let it fly the test motions.

.. warning::

   Save a known-good snapshot or tuning profile **before** you run AutoTune, and
   fly it in open, calm airspace with room to abort. Treat a connected aircraft
   as a real aircraft.

The full step-by-step in-air procedure sits behind a collapsible on the task so
it is there when you need it without crowding the setup. For the underlying
theory, see the ArduPilot `Autotune
<https://ardupilot.org/copter/docs/autotune.html>`__ page.

Profiles
--------

The **Profiles** task captures the current live or staged tune into a reusable,
locally stored tuning profile. A saved profile can be diffed against the live
controller later and restaged through the same review flow, which makes it easy
to keep a small library of known-good tunes for similar builds. Protect a
profile to guard a baseline from accidental deletion.

Review
------

Staged pilot settings, gains, and filters collect in the **Review** task as a
grouped diff. Writing them runs the same verified write path as everywhere else
in the app — each value is sent and confirmed against the controller's read-back
— so nothing changes on the aircraft until you apply it.

.. warning::

   Always save a known-good snapshot or tuning profile before pushing
   responsiveness higher, and validate every change with a short hover or
   line-of-sight test before stacking more. Treat a connected aircraft as a real
   aircraft.

.. _initial-tune:

Initial Tune
------------

**Initial Tune** works out a starting point for a *new* airframe from three
facts about it — prop diameter, battery cell count, and cell chemistry — and
stages the parameters that follow from them. It is where a fresh build begins,
before there is anything worth autotuning.

It uses the same formulas as Mission Planner's *Initial Parameters* screen, so
the numbers agree with what that tool would have given you.

What it sets, all of it driven by prop size or the pack:

- ``INS_GYRO_FILTER`` and ``INS_ACCEL_FILTER``, plus the matching
  ``ATC_RAT_*_FLT*`` rate-loop filters — bigger props, lower cutoffs.
- ``ATC_ACCEL_{R,P,Y}_MAX`` acceleration limits and ``ACRO_YAW_P``.
- ``MOT_THST_EXPO`` and a ``MOT_THST_HOVER`` starting guess.
- ``BATT_ARM_VOLT`` / ``BATT_CRT_VOLT`` / ``BATT_LOW_VOLT`` and
  ``MOT_BAT_VOLT_MIN`` / ``MAX`` from the cell count and chemistry.

Two options change the result: **T-Motor ESCs** flattens the thrust curve to a
fixed expo and pins the PWM range, and **Failsafes & fence** adds the suggested
battery-failsafe actions plus a 120 m / 150 m fence.

.. important::

   **It sets no PID gains.** Prop diameter says nothing about P, I or D, so
   ``ATC_RAT_*_P/I/D`` are left exactly as they are. This gets an airframe to a
   first hover that is safe to fly; **Autotune** and **Log Tuning** do the
   actual tuning from there.

The table lists only the values that would change, each showing what the
vehicle has now next to what it would become, with the reasoning on hover.
Nothing is written — **Stage** puts the batch into the same review queue as
every other tuning change, and you apply it there.

Log Tuning
----------

**Log Tuning** (beta) works backwards from a flight: upload a dataflash log and
the in-browser analyzer looks for what needs fixing, then stages the parameter
changes for you to review. It runs entirely in the browser — the log never
leaves your machine — and it works on **compass-less** setups (no magnetometer
needed).

What it does:

- **Vibration & oscillation** — FFTs the gyro (the high-rate IMU batch sampler
  when present, otherwise the IMU log) to find the dominant frequencies, and
  flags a sharp single-axis low-frequency peak as a **rate-loop limit cycle**
  (the classic "it buzzes in the hover on one axis" problem).
- **Motor noise / harmonic notch** — reads ESC RPM telemetry to find the motor
  fundamental and recommends enabling / placing the harmonic notch
  (``INS_HNTCH_*``).
- **Rate gains** — when a limit cycle is found on an axis it recommends lowering
  that axis's rate ``D``.

**You need a good log.** The tool warns about this up front, and gates a bench
session (no real flight data) as unusable. For the best results:

#. Fly (or hover) for a real **30–60 s**, not a bench spin-up.
#. Enable the IMU batch sampler for a proper high-frequency spectrum
   (``INS_LOG_BAT_MASK``), and have ESC RPM telemetry for the notch.
#. A poor log gives poor advice — treat the recommendations as a starting point,
   apply one change, and re-fly.

How to use it:

#. **Tuning → Log Tuning**, then **Choose flight log (.bin)** and pick a log off
   the SD card (or one you've already downloaded via the Files tab).
#. Read the summary, the per-axis dominant frequencies, the vibration verdict,
   and any detected limit cycle.
#. For each recommendation, click **Stage** (or **Stage all**). Each confidence
   is tagged (high / medium / low).
#. The staged changes appear in the Tuning **Review** tab and the global draft
   bar — **nothing is written to the aircraft** until you review and apply them
   there through the normal verified-write path. Then re-fly and repeat.

.. note::

   Log Tuning is advisory: it reproduces the manual "read the log, place the
   notch, break the limit cycle" analysis, but you stay in the loop. Apply one
   change at a time so the next log cleanly shows its effect.

For the underlying control theory and a recommended tuning order, see the
ArduPilot `tuning guide <https://ardupilot.org/copter/docs/tuning.html>`__ and
`Autotune <https://ardupilot.org/copter/docs/autotune.html>`__ pages.
