Tuning
======

The **Tuning** tab is a product-shaped front end for ArduCopter's attitude
controllers. It groups the rate gains, stick feel, and filters that an operator
actually adjusts into curated cards — backed by real ArduPilot parameters — so a
tune can be roughed in without diving into the raw parameter tree. Every change
is staged as a local draft and reviewed before it is written to the controller,
and known-good tunes can be saved as reusable profiles.

.. contents:: On this page
   :local:
   :depth: 1

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

Angle (Stabilize) feel and rates
---------------------------------

The **Rates** task covers how the aircraft responds to your sticks — the angle
(self-levelling) feel and the acro-style rate shaping that sit above the rate
controllers:

- ``ATC_INPUT_TC`` — input smoothing / time constant.
- ``ATC_ANGLE_MAX`` (or the legacy ``ANGLE_MAX`` in centidegrees) — maximum lean
  angle in Stabilize/Loiter.
- ``PILOT_Y_RATE`` / ``PILOT_Y_EXPO`` — yaw authority and centre softening.
- ``ACRO_RP_RATE`` / ``ACRO_Y_RATE`` and ``ACRO_RP_EXPO`` / ``ACRO_Y_EXPO`` —
  acro rotation rates and expo, drawn live as rate curves.
- ``ATC_ACCEL_R_MAX`` / ``ATC_ACCEL_P_MAX`` / ``ATC_ACCEL_Y_MAX`` (4.5+ uses the
  degrees-based ``ATC_ACC_*_MAX``) — angular-acceleration limits that bound how
  aggressively the controller chases a commanded rate.

Rates set the maximum rotation speed; expo softens the centre without reducing
full-stick authority. The view drops any parameter the connected firmware does
not stream, so only the form your firmware version uses is shown.

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

Profiles, review, and Autotune
------------------------------

Staged rates, gains, and filters collect in the **Review** task as a grouped
diff. Writing them runs the same verified write path as everywhere else in the
app — each value is sent and confirmed against the controller's read-back — so
nothing changes on the aircraft until you apply it.

The **Profiles** task captures the current live or staged tune into a reusable,
locally stored tuning profile. A saved profile can be diffed against the live
controller later and restaged through the same review flow, which makes it easy
to keep a small library of known-good tunes for similar builds. Protect a
profile to guard a baseline from accidental deletion.

**Autotune** is an ArduPilot firmware feature, not a configurator surface: it is
a flight mode that flies the aircraft through small test motions to discover
rate and angle gains automatically. It is a good starting point when you have no
baseline; the saved-profile and review tools here are then used to capture,
compare, and refine the result.

.. warning::

   Always save a known-good snapshot or tuning profile before pushing
   responsiveness higher, and validate every change with a short hover or
   line-of-sight test before stacking more. Treat a connected aircraft as a real
   aircraft.

For the underlying control theory and a recommended tuning order, see the
ArduPilot `tuning guide <https://ardupilot.org/copter/docs/tuning.html>`__ and
`Autotune <https://ardupilot.org/copter/docs/autotune.html>`__ pages.
