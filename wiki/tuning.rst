Tuning
======

The **Tuning** tab is a product-shaped front end for ArduCopter's attitude
controllers. It groups the stick feel, rate gains, and filters that an operator
actually adjusts into curated cards — backed by real ArduPilot parameters — so a
tune can be roughed in without diving into the raw parameter tree. Every change
is staged as a local draft and reviewed before it is written to the controller,
and known-good tunes can be saved as reusable profiles.

The tab is split into seven tasks: **Pilot**, **PID Gains**, **Filters**,
**Autotune**, **Profiles**, **Review**, and **Log Tuning**. The workspace is
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

The **Filters** task groups the rate-controller filters so a noise-handling pass
can be reviewed as one deliberate change. Each axis exposes a target, error, and
D-term filter frequency:

- ``ATC_RAT_RLL_FLTT`` / ``ATC_RAT_RLL_FLTE`` / ``ATC_RAT_RLL_FLTD``
- ``ATC_RAT_PIT_FLTT`` / ``ATC_RAT_PIT_FLTE`` / ``ATC_RAT_PIT_FLTD``
- ``ATC_RAT_YAW_FLTT`` / ``ATC_RAT_YAW_FLTE`` / ``ATC_RAT_YAW_FLTD``

Higher frequencies preserve response but pass more noise; lower values smooth
noise at the cost of latency. Zero is valid for some of these and intentionally
disables that filter path.

.. note::

   The Tuning tab covers the rate-loop filters only. The gyro harmonic notch
   that suppresses motor-frequency noise (``INS_HNTCH_*``) is configured in the
   :doc:`parameters` (Expert) tab — see the ArduPilot tuning docs for setting it
   up from in-flight FFT logging.

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
