Tuning
======

The **Tuning** tab is a front end for ArduCopter's attitude controllers. It
groups stick feel, rate gains and filters into cards backed by ArduPilot
parameters, so you can rough in a tune without the raw parameter tree. Every
change is staged as a local draft and reviewed before it is written to the
controller. You can save known-good tunes as reusable profiles.

By default the tab shows **four tasks**: **Pilot**, **Filters**, **Autotune**
and **Initial Tune**. Together they cover setting stick feel, handling noise,
letting the vehicle find its gains, and getting a starting point for a new
airframe.

**Expert mode** adds four more: **PID Gains** (the attitude gains, axis by axis),
**Notches** (the two harmonic notches and the ``FILTn`` bank), **Profiles** (a
local library of saved tunes) and **Log Tuning** (post-flight log analysis).
They are for working on a tune you already have.

There is no separate review step. Whatever a task stages lands in the **draft
bar** at the foot of the page, and **Write all** there sends it (see
:ref:`tuning-applying`).

Every task uses the same layout: **grids, with the settings down the side and
the axes across** (Roll / pitch | Yaw, Notch 1 | Notch 2, Climb | Descent).
Each value is a typed box with its unit, so you can always enter any value.
Where the firmware defines named values (*Medium*, *Crisp*, *Low* expo…), a
dropdown beside the box offers them. Older firmware that stores a value in
centi-units (cm/s, centidegrees/s²) is shown and edited in m and degrees, and
written back in the firmware's units.

A small **dot** beside a value means it differs from the firmware default.
Click it to stage the default. The defaults come from the vehicle itself
(``@PARAM/param.pck`` with defaults, ArduPilot 4.5+), so older firmware shows
no dots. Every value also has an **"i"** bubble with the parameter's name,
description and a link to its reference page.

.. admonition:: Example: the default dot

   ``ATC_INPUT_TC`` defaults to 0.15 (*Medium*). Pick *Crisp* and a dot appears
   beside the box. Hover it for *Changed from the default (0.15). Click to
   reset.* Clicking stages 0.15 again.

Pilot
-----

The **Pilot** task holds everything that shapes how manual flight *feels*,
apart from the PID gains. ArduPilot models each stick as a *command model*: a
maximum rate, an expo and a response time (``AC_CommandModel``; copter docs,
*Input shaping*). The cards follow that model.

**Angle modes** (Stabilize, AltHold, Loiter), columns Roll / pitch | Yaw:

- **Max:** ``ATC_ANGLE_MAX`` (legacy ``ANGLE_MAX``) lean, and ``PILOT_Y_RATE``
  yaw rate.
- **Expo:** ``PILOT_Y_EXPO``.
- **Response:** ``ATC_INPUT_TC`` and ``PILOT_Y_RATE_TC``, from *Very soft* (0.5)
  to *Very crisp* (0.05). Under the columns the card shows full lean in about
  3 × the time constant, and the time to full yaw rate. It warns when the yaw
  rate outruns ArduPilot's rule of about half the yaw accel limit.

**Acro** (Roll / pitch | Yaw): **Rate** (``ACRO_RP_RATE`` / ``ACRO_Y_RATE``),
**Expo**, **Response** (``ACRO_*_RATE_TC``, 0 = off) and **Accel limit**
(``ATC_ACC_*_MAX``, older ``ATC_ACCEL_*_MAX`` shown in deg/s²; roll and pitch share
one box while they match). Under each column is the time to full rate (rate ÷
accel limit). Below the grid a **stick curve** plots both axes: stick position
against rotation rate, using ArduPilot's own expo formula. The accel limits come
from AutoTune. Lower them to soften the feel, but don't raise them past the
AutoTune values.

.. admonition:: Example: reading the Acro grid

   With ``ACRO_RP_RATE`` **360** °/s, ``ACRO_RP_EXPO`` **0.3** (*Medium*) and a
   roll accel limit of **1409** °/s²:

   - Full stick asks for 360 °/s. Half stick asks for
     360 × (1 − 0.3) × 0.5 ÷ (1 − 0.3 × 0.5) ≈ **148 °/s**, not 180. That is
     what expo does, and the curve under the grid shows it (hover over it to
     read any stick position).
   - **Full rate in 0.26 s** is 360 ÷ 1409. The accel limit, not the rate,
     decides how quickly the quad gets there.
   - Typing **0.35** for expo is fine. The dropdown then reads *Custom*.

.. admonition:: Example: the yaw rule

   ArduPilot suggests ``PILOT_Y_RATE`` ≈ half the yaw accel limit, so full yaw
   rate arrives in about half a second. With a yaw accel limit of **293** °/s²:

   - ``PILOT_Y_RATE`` **180** → full rate in 0.61 s. No warning.
   - ``PILOT_Y_RATE`` **360** → full rate in 1.2 s, and the card warns:
     *limited by yaw accel. Try ≤ 147 °/s.*

**Alt Hold** (folded): Climb | Descent max speed (``PILOT_SPD_UP`` /
``PILOT_SPD_DN``; *Same as climb* = 0), vertical accel for both, then throttle
deadzone, throttle filter (*Off* = 0) and takeoff altitude. Below them is the
**altitude controller** (see :ref:`tuning-althold-controller`).

**Loiter** (folded), columns Moving | Braking: accel, max speed, max lean
(*Auto* = 0, two thirds of the angle limit), braking jerk and delay.

.. admonition:: Example: units on older firmware

   ArduCopter 4.5 stores ``LOIT_SPEED`` in cm/s. A vehicle reporting **1250**
   shows **12.5 m/s**, and typing **10** writes **1000**. Likewise
   ``ATC_ACCEL_R_MAX`` **140900** (centidegrees/s²) shows as **1409 °/s²**.
   On 4.6+ the SI-named parameters (``LOIT_SPEED_MS``, ``ATC_ACC_R_MAX``) are
   already in those units and are written as typed.

The view drops any parameter the connected firmware does not stream, so you
only see the form your firmware version uses.

.. _tuning-althold-controller:

Altitude controller (Alt Hold)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The stick-feel settings set the climb rate the stick asks for. The altitude
controller (``AC_PosControl``) holds it: position error → climb rate →
vertical acceleration → throttle, starting from the hover throttle. Its gains
sit under the stick feel on the **Alt Hold** card:

- ``MOT_THST_HOVER`` / ``MOT_HOVER_LEARN``: the hover throttle and whether it
  is learned.
- ``PSC_D_POS_P`` and ``PSC_D_VEL_P`` / ``PSC_D_VEL_I``: the outer loops.
- ``PSC_D_ACC_P`` / ``PSC_D_ACC_I`` / ``PSC_D_ACC_IMAX``: the vertical
  acceleration loop. On 4.6 these are ``PSC_ACCZ_*`` at **ten times** the scale
  (``AC_PosControl.cpp``: *"If upgrading from 4.6 this is _ACCZ_P * 0.1"*).

**The accel gains follow the hover throttle.** The same gain does more on a quad
that hovers at low throttle, because each bit of throttle is more thrust.
ArduPilot's initial tuning guide (*Test AltHold*) gives this rule once the hover
throttle is known:

- 4.7: ``PSC_D_ACC_P`` = 0.1 × ``MOT_THST_HOVER``, ``PSC_D_ACC_I`` = 0.2 ×
- 4.6: ``PSC_ACCZ_P`` = ``MOT_THST_HOVER``, ``PSC_ACCZ_I`` = 2 ×

The card checks the gains against that rule, with messages such as *"Far too
high for this hover throttle. Expect AltHold to bounce."* It shows the suggested
values next to yours, and **Use suggested gains** stages them. The check
includes drafts, so staging a new hover throttle re-checks the gains at once.
The card also says when hover learning is off, when ``I`` is out of proportion
to ``P`` (the usual ratio is 2 : 1), and when the hover throttle is at its
floor.

.. important::

   ``MOT_THST_HOVER`` cannot go below **0.125** (``AP_MOTORS_THST_HOVER_MIN``).
   If a quad hovers lower (a log shows it as ``CTUN.ThO``), it is overpowered
   for the controller, and the right gains are lower still than the rule gives
   for 0.125. The gentler fix is the airframe: lower-pitch props, lower KV or
   fewer cells bring the hover up.

.. admonition:: Example: the gain check

   - **Default build, 4.7:** hover 0.35 → suggested ``PSC_D_ACC_P`` **0.035**,
     ``PSC_D_ACC_I`` **0.07**. (On 4.6: ``PSC_ACCZ_P`` 0.35 and ``PSC_ACCZ_I``
     0.7, the same gains at ten times the scale.)
   - **A light, powerful quad that bounces:** hover 0.20, ``PSC_D_ACC_P`` 0.10,
     ``PSC_D_ACC_I`` 0.20. Suggested 0.02 / 0.04, so both are five times the
     rule: *Far too high for this hover throttle. Expect AltHold to bounce.*
     **Use suggested gains** stages 0.02 / 0.04.
   - **Hover at the floor:** with ``MOT_THST_HOVER`` at 0.125 the card adds that
     the quad may hover lower (a log will show it) and then needs lower gains
     still. In one case the log showed 0.05, and gains of 0.015 / 0.03 stopped
     a 5 Hz bounce.

**AltHold test flight** (on the card, folded):

#. Set ``MOT_HOVER_LEARN`` to 2 (learn and save).
#. Take off in Stabilize to about 5 m, switch to AltHold, and hover for 30 s
   with the throttle stick **centred**.
#. Land and disarm. ``MOT_THST_HOVER`` now holds the learned hover.
#. Stage the accel gains from it.
#. If AltHold still oscillates up and down, halve ``PSC_D_POS_P`` and
   ``PSC_D_VEL_P``.

Hover learning only runs while the requested climb rate is **exactly zero**
(``Copter::update_throttle_hover``): stick centred, level, not climbing or
sinking fast. A quad that bounces never meets that, so its ``MOT_THST_HOVER``
never moves. Set it by hand (or from a log) first. Also, a stick held below the
deadzone keeps lowering the target altitude. A quad that cannot descend fast
enough ends up metres above a target that keeps running away.

The fast-rate thread (``FSTRATE_ENABLE``) does not speed this controller up. It
runs the roll, pitch and yaw rate loops. The altitude controller runs in the
main loop at ``SCHED_LOOP_RATE``.

Attitude controllers (PID gains)
--------------------------------

The **PID Gains** task shows both attitude loops, grouped by axis. The
**angle** controller (Mission Planner calls this column *Stabilize*) turns the
error between the demanded and actual angle into a demanded *rate*. The
**rate** controller, the innermost loop, turns that demanded rate into motor
output. Each axis card lists its angle P first, in the order the signal travels:

- ``ATC_ANG_RLL_P`` / ``ATC_RAT_RLL_P`` / ``ATC_RAT_RLL_I`` / ``ATC_RAT_RLL_D`` / ``ATC_RAT_RLL_FF``
- ``ATC_ANG_PIT_P`` / ``ATC_RAT_PIT_P`` / ``ATC_RAT_PIT_I`` / ``ATC_RAT_PIT_D`` / ``ATC_RAT_PIT_FF``
- ``ATC_ANG_YAW_P`` / ``ATC_RAT_YAW_P`` / ``ATC_RAT_YAW_I`` / ``ATC_RAT_YAW_D`` / ``ATC_RAT_YAW_FF``

The grid has Roll | Pitch | Yaw across, and Angle P, Rate P, I, D and
Feedforward down. **Link roll & pitch** (on by default) keeps the two axes
coupled, angle P included, while you rough in a baseline. Untick it only if the
airframe needs an asymmetric tune. **More rate-loop terms** folds the rarer
ones: I max (``ATC_RAT_*_IMAX``), D feedforward (``_D_FF``), P + D max
(``_PDMX``) and slew max (``_SMAX``). **Scale the whole tune** (folded)
multiplies P & I, D, feedforward, pitch against roll, and the filter
frequencies. It shows which values would change and stages them in one go.

.. admonition:: Example: scaling the tune

   Roll and pitch rate P 0.10, I 0.135; yaw P 0.18, I 0.018. Set **P & I** to
   **1.1** and the preview reads *Roll P 0.11 · Roll I 0.149 · Pitch P 0.11 ·
   Pitch I 0.149 · Yaw P 0.198 · Yaw I 0.02*. **Stage scaled values** stages all
   six. The D and feedforward gains stay as they are.

.. note::

   Feedforward makes the rate follow the stick more immediately. Don't use it
   to mask a weak base tune. If you move P, I or D significantly, re-check the
   filters and do a short test flight before stacking more changes.

Filters
-------

The **Filters** task starts with the derived filter set. In the default
(non-Expert) mode that is the only filter panel: you give it one number and it
works out the rest.

Set filters from the gyro cutoff
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Enter the gyro cutoff you want and the tab fills in the filter set ArduPilot
derives from it. You can edit every proposal before staging. Staging goes
through the normal draft path: the values land in the fields above, show as
staged, and are written by the same reviewed **Apply** as any other edit. This
panel writes nothing to the vehicle.

The ratios are ArduPilot's own:

- ``ATC_RAT_RLL_FLTD`` and ``ATC_RAT_PIT_FLTD``: the gyro cutoff **halved**.
  ``ATC_RAT_YAW_FLTD``: a **quarter** of it. From ArduPilot's *Aggressive Rate
  Loop Tuning* page: *"each axis' ATC_RAT_xxx_FLTD should be INS_GYRO_FILTER/2
  on roll and pitch and INS_GYRO_FILTER/4 on yaw"*. Yaw is filtered harder
  because D is the most active term, passes the most noise, and is the one that
  heats motors.
- ``ATC_RAT_RLL_FLTT`` / ``ATC_RAT_PIT_FLTT``: a fixed **50 Hz**.
  ``ATC_RAT_YAW_FLTT``: a fixed **30 Hz**. These stay the same whatever the
  cutoff. They filter the pilot's *demand*, not a measured signal, so they need
  not track the sensor. Roll and pitch carry the stick demand the pilot flies,
  so they sit higher. On yaw the extra smoothing costs nothing you can feel.
  ArduPilot's own pages say gyro ÷ 2 here. This app departs from that on
  purpose, and like every row it is editable before staging.
- ``ATC_RAT_YAW_FLTE``: a fixed 2 Hz, from *Setting the Aircraft Up for
  Tuning*.
- The cutoff itself is offered as three starting points by prop size: **90 Hz
  for 5-inch, 60 Hz for 10-inch, 40 Hz for 15-inch**. These are this app's
  numbers. ArduPilot's docs table (80 / 40 / 20 Hz for 5, 10 and 20-inch props)
  and Mission Planner's curve both filter harder. The app's values suit the
  low-noise FPV builds the tab is aimed at, where a higher cutoff keeps response
  the airframe can use. They are buttons, and you choose. The app cannot see
  what is bolted to the frame, and a hover log is what settles the number.

Roll and pitch ``FLTE`` are not proposed. Mission Planner zeroes them, but
ArduPilot's pages do not say to, so there is no documented value to stage.

A D-term filter edited above **0.75 × the gyro cutoff** is flagged inline.
ArduPilot documents that as not recommended.

.. admonition:: Example: a 40 Hz gyro cutoff

   Enter **40** and the panel proposes:

   ================================  ==========  ===================
   Parameter                         Proposed    Rule
   ================================  ==========  ===================
   ``INS_GYRO_FILTER``               40 Hz       the cutoff you typed
   ``ATC_RAT_RLL_FLTD`` / ``PIT``    20 Hz       gyro ÷ 2
   ``ATC_RAT_YAW_FLTD``              10 Hz       gyro ÷ 4
   ``ATC_RAT_RLL_FLTT`` / ``PIT``    50 Hz       fixed
   ``ATC_RAT_YAW_FLTT``              30 Hz       fixed
   ``ATC_RAT_YAW_FLTE``              2 Hz        fixed
   ================================  ==========  ===================

   Change roll D to **35** before staging and it is flagged: 35 is above
   0.75 × 40 = 30 Hz.

Manual (Expert)
~~~~~~~~~~~~~~~

Expert mode adds **Manual** below the derived panel: every smoothing parameter,
the gyro and accel filters, then a Roll | Pitch | Yaw grid of target, error and D
filters, all in Hz.

Use it for a value the derived panel does not set, or one that departs from
ArduPilot's ratios. A few parameters appear only here, because there is no
documented rule to derive them from: ``INS_ACCEL_FILTER`` and
``ATC_RAT_RLL_FLTE`` / ``ATC_RAT_PIT_FLTE``.

.. note::

   The **harmonic notches** and the ``FILTn`` filter bank have their own task
   (see :ref:`tuning-notches` below). A low-pass cutoff trades noise against
   latency and is set by judgement. A notch removes one *measured* frequency.

.. _tuning-notches:

Notches (Expert)
----------------

The two **harmonic notches** and the ``FILTn`` filter bank are on the
**Notches** task, which is Expert-only. The notches sit side by side (Notch 1 |
Notch 2, the same settings down). The filter bank has its slots across (FILT1 |
FILT2 | FILT3: type, frequency, Q, attenuation), with a Roll | Pitch | Yaw grid
choosing which slot each axis's target and error filter uses.

A notch removes a narrow band (motor noise and its harmonics) without the
latency of a lower low-pass cutoff. ArduPilot has **two independent harmonic
notches** (``INS_HNTCH_*`` and ``INS_HNTC2_*``, ``harmonic_notches[0]`` and
``[1]``), so one can track ESC telemetry or the in-flight FFT while the other
sits at a fixed frequency. Both are configurable here.

Place them from a log, not by ear. **Log Tuning** reads a ``.bin`` and
recommends the frequency, bandwidth and reference, and the Notches task points
you to it.

Everything else is yours
~~~~~~~~~~~~~~~~~~~~~~~~

**Nothing else is derived.** Fields show what the vehicle is running, and an
untouched field stages nothing. The common rate-loop ratios come from Mission
Planner's *Initial Parameters* screen, not from ArduPilot's own documentation,
so this page does not compute them. You set them.

Each parameter gets its proper editor: ``INS_HNTCH_MODE`` is a named list,
``INS_HNTCH_OPTS`` and ``INS_HNTCH_HMNCS`` are per-bit toggles, and everything
else is a number with the units and range the firmware declares. That includes
the **attenuation**, ``INS_HNTCH_ATT`` / ``INS_HNTC2_ATT``: how deep the notch
cuts, 5 to 50 dB, default 40. Above about 40 dB it is a hard notch, not a modest
cut (``HarmonicNotchFilter.cpp``). Every field has the usual **"i"** bubble
naming the raw parameter, with a link to its page in the
:doc:`parameter reference <parameters>`.

Two suggestions, both documented
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

These are the only calculations on the page. Each is a link beside its field,
shown only when it differs from what is set. Clicking it fills the field, and
you can then edit the value or ignore it:

- **Bandwidth:** ``INS_HNTCH_BW`` at half the centre frequency. ArduPilot's
  parameter documentation says *"This is typically set to half the base
  frequency"*, and the throttle-based notch setup gives ``BW = hover_freq /
  2``.
- **Reference:** ``INS_HNTCH_REF``. ArduPilot documents ``1`` for RPM and
  ESC-telemetry tracking, and the hover thrust (``MOT_THST_HOVER``) for
  throttle mode. Nothing is suggested for Fixed or in-flight FFT, because the
  docs give no value for them.

.. important::

   An ``INS_HNTCH_REF`` of zero *"disables dynamic updates"*. An enabled notch
   with the reference still at zero looks configured but tracks nothing. The
   editor warns when it sees that combination.

.. admonition:: Example: the two suggestions

   - **Throttle mode**, frequency **100** Hz, bandwidth still 40 → beside
     bandwidth: *Use 50 (half the frequency)*. At 80 Hz with bandwidth 40 there
     is nothing to suggest, so nothing shows.
   - **ESC telemetry mode** → beside reference: *Use 1*. No bandwidth
     suggestion: the frequency is measured, and ArduPilot gives no ratio.
   - **Enabled, reference 0** → under that notch's column: *Reference 0 turns
     tracking off.*

Half the centre frequency is the **throttle-mode** rule. In that mode the
frequency is inferred from throttle position, so the notch has to be wide enough
to cover the error. With a measured source (ESC telemetry, an RPM sensor,
in-flight FFT) the frequency is known and a narrower notch is usual. A 15-inch
build might run ``FREQ 40`` with ``BW 10``. There is no documented ratio for
those modes, so none is offered.

Where the notch frequency comes from
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``INS_HNTCH_FREQ`` is labelled **Notch frequency floor**, because that is what
it does in every mode: nothing below it is notched. The firmware clamps the
tracked centre to it (*"don't let the notch go below the min frequency"*,
``HarmonicNotchFilter.cpp``) and fades the attenuation out below it. In
**Fixed** mode it is also the centre. In **Throttle** mode it is the centre at
the reference thrust. With a measured source the centre rides above it. The
floor is this value × ``INS_HNTCH_FM_RAT``, so at the default ratio of 1 it is
exactly the frequency you set.

The frequency depends on the motors, not on the gyro filter, so it cannot be
derived. The usual ways to find it:

- **Post-flight FFT:** set ``INS_LOG_BAT_MASK = 1`` and ``INS_LOG_BAT_OPT =
  4``, hover, then open the log in Mission Planner (SETUP → ADVANCED → FFT →
  *IMU Batch Sample*) and read the peak at the motor rotational frequency.
  Expect roughly 200 Hz on a small copter, nearer 100 Hz on a large one.
- **ESC telemetry** (``INS_HNTCH_MODE`` 3) or an **RPM sensor** (2 or 5): the
  autopilot reads RPM directly, and ``INS_HNTCH_FREQ`` becomes the lower limit
  the tracked notch will not go below.
- **In-flight FFT** (mode 4): the autopilot runs its own FFT. ArduPilot calls
  it *"probably the best mode if the autopilot is capable"*. It needs an H7 or
  F7 board.
- **Throttle** (mode 1): hover frequency from a log, scaled by throttle.
  ``MOT_HOVER_LEARN = 2`` learns the hover thrust for the reference.

``INS_HNTCH_OPTS`` is editable and decoded as you type, so a bitmask reads back
as names: ``22`` is *Multi-Source, Update at loop rate, Triple notch*.

Like every other tuning task, it stages drafts. Nothing is written until you
**Write all** from the draft bar.

Autotune
--------

**AutoTune** is an ArduPilot flight mode that flies the aircraft through small
test motions to find rate and angle gains automatically. It is a good starting
point when you have no baseline. Use the **Autotune** task to configure the run
before you take off. It does not tune on the bench:

- ``AUTOTUNE_AXES``: which axes to tune (roll, pitch, yaw, or a combination).
- ``AUTOTUNE_AGGR``: tuning aggressiveness. Higher values aim for a tighter,
  more responsive tune.
- ``AUTOTUNE_MIN_D``: a floor on the discovered D term.
- ``AUTOTUNE_GMBK``: gain margin backoff applied after tuning.

Set these here. They stage like every other setting and are written from the
draft bar. Then switch to the AutoTune flight mode in the air and let it fly
the test motions. (The :ref:`autotune-flight` card on Calibration → Flight
records the before-and-after values for that flight.)

.. warning::

   Save a known-good snapshot or tuning profile **before** you run AutoTune, and
   fly it in open, calm airspace with room to abort. Treat a connected aircraft
   as a real aircraft.

The full step-by-step in-air procedure is in a collapsible section on the task.
For the underlying theory, see the ArduPilot `Autotune
<https://ardupilot.org/copter/docs/autotune.html>`__ page.

Profiles
--------

The **Profiles** task saves the current tune into a locally stored tuning
profile. One row (name, what to save, **Save**) saves either the live values
only or the live values with your staged changes on top. You can later diff a
saved profile against the live controller and restage it through the same
review flow. Use this to keep a small library of known-good tunes for similar
builds. Protect a profile to stop a baseline being deleted by accident.

.. _tuning-applying:

Applying
--------

Staged pilot settings, gains, filters and notches collect in the **draft bar**
at the bottom of the page, which shows the staged count. **Show changes** lists
each draft as *current → new*, **Write all** sends them, and **Discard** drops
them. Writing uses the same verified write path as the rest of the app: each
value is sent and confirmed against the controller's read-back. Nothing changes
on the aircraft until you write it.

.. warning::

   Always save a known-good snapshot or tuning profile before pushing
   responsiveness higher, and check every change with a short hover or
   line-of-sight test before stacking more. Treat a connected aircraft as a real
   aircraft.

.. _initial-tune:

Initial Tune
------------

**Initial Tune** works out a starting point for a *new* airframe from three
facts about it: prop diameter, battery cell count and cell chemistry. It stages
the parameters that follow from them. Start a fresh build here, before there is
anything worth autotuning. The preview lists each change by name (raw id beside
it) in the same units as the Pilot task, grouped Stick feel, Filters, Motors,
Battery, and Failsafes & fence.

It uses the same formulas as Mission Planner's *Initial Parameters* screen, so
the numbers match what that tool gives, with two corrections noted below.

In the default mode it asks only those three questions and then stages the
result. The parameter-by-parameter working is an **Expert** view, as are the
two option checkboxes (**T-Motor ESCs**, **Failsafes & fence**). The button
shows the count of what will be staged in either mode (**Stage n changes**).
Nothing is written until you **Write all** from the draft bar.

What it sets, all driven by prop size or the pack:

- ``INS_GYRO_FILTER`` and ``INS_ACCEL_FILTER``, plus the matching
  ``ATC_RAT_*_FLT*`` rate-loop filters. Bigger props get lower cutoffs.
- ``ATC_ACCEL_{R,P,Y}_MAX`` acceleration limits and the acro yaw rate.
  ArduCopter 4.2 replaced ``ACRO_YAW_P`` with ``ACRO_Y_RATE`` (converted with a
  ×45 factor), so ``ACRO_Y_RATE`` is what gets staged. The old name is used
  only on a vehicle that still reports it.
- ``MOT_THST_EXPO`` and a ``MOT_THST_HOVER`` starting guess.
- ``BATT_ARM_VOLT`` / ``BATT_CRT_VOLT`` / ``BATT_LOW_VOLT`` and
  ``MOT_BAT_VOLT_MIN`` / ``MAX`` from the cell count and chemistry. Four
  chemistries are offered: **LiPo** (4.2 V/cell full, 3.3 V empty), **LiPo
  HV** (4.35 / 3.3), **Li-ion** (4.2 / 2.7) and **Li-ion HV** (4.35 / 2.7).
  Mission Planner's 4.1 V / 2.8 V for Li-ion is neither the cell's charge
  voltage nor its discharge floor. These values set the range the thrust
  compensation scales across, so a tenth of a volt per cell matters from the
  moment the pack comes off the charger.

Two options change the result. **T-Motor ESCs** flattens the thrust curve to a
fixed expo and pins the PWM range. **Failsafes & fence** adds the suggested
battery-failsafe actions plus a 120 m / 150 m fence.

.. important::

   **It sets no PID gains.** Prop diameter says nothing about P, I or D, so
   ``ATC_RAT_*_P/I/D`` are left as they are. This gets an airframe to a first
   hover that is safe to fly. **Autotune** and **Log Tuning** do the tuning
   from there.

.. admonition:: Example: a 9-inch quad on 4S LiPo

   Prop **9**, cells **4**, **LiPo**, against the demo vehicle's values (nine of
   the fourteen rows):

   ==================  =========================  ========  ========
   Group               Setting                    Now       New
   ==================  =========================  ========  ========
   Stick feel          Roll / pitch accel limit   1409      1259 °/s²
   Stick feel          Yaw accel limit            293       279 °/s²
   Stick feel          Acro yaw rate              240       139.5 °/s
   Filters             Gyro filter                40        46 Hz
   Filters             Roll / pitch D filter      35        23 Hz
   Filters             Yaw D filter               0         11.5 Hz
   Motors              Hover throttle             0.35      0.2
   Battery             Arm voltage                13.8      14.7 V
   Battery             Critical voltage           13.8      14 V
   ==================  =========================  ========  ========

   **Stage 14 changes** puts them in the draft bar. Nothing is written until
   **Write all**.

The table lists only the values that would change. Each row shows what the
vehicle has now next to what it would become, with the reasoning on hover. A
parameter the connected vehicle does not report is left out, because it could
only stage as invalid, and one invalid row blocks the whole batch. Nothing is
written here: **Stage n changes** puts the batch into the same draft bar as
every other tuning change, and you write it there.

Log Tuning
----------

**Log Tuning** (beta) works backwards from a flight. Upload a dataflash log and
the in-browser analyzer looks for problems, then stages parameter changes for
you to review. It runs entirely in the browser, so the log never leaves your
machine. It works on **compass-less** setups (no magnetometer needed).

What it does:

- **Vibration & oscillation:** FFTs the gyro (the high-rate IMU batch sampler
  when present, otherwise the IMU log) to find the dominant frequencies, and
  flags a sharp single-axis low-frequency peak as a **rate-loop limit cycle**
  (the classic "it buzzes in the hover on one axis" problem).
- **Motor noise / harmonic notch:** reads ESC RPM telemetry to find the motor
  fundamental and recommends enabling or placing the harmonic notch
  (``INS_HNTCH_*``).
- **Rate gains:** when it finds a limit cycle on an axis, it recommends lowering
  that axis's rate ``D``.

**You need a good log.** The tool warns about this up front, and rejects a
bench session (no real flight data) as unusable. For the best results:

#. Fly (or hover) for **30–60 s**. A bench spin-up is not enough.
#. Enable the IMU batch sampler for a proper high-frequency spectrum
   (``INS_LOG_BAT_MASK``), and have ESC RPM telemetry for the notch.
#. A poor log gives poor advice. Treat the recommendations as a starting point,
   apply one change, and re-fly.

How to use it:

#. Open **Tuning → Log Tuning**, then choose a ``.bin`` from disk or press
   **Pick from vehicle** to read one off the connected aircraft. If the log is
   missing the batch-sampler data, **Set up logging for tuning** takes you to
   the Logs tab's card of the same name (see :doc:`logs-inspectors`).
#. Read the summary, the per-axis dominant frequencies, the vibration verdict,
   and any detected limit cycle.
#. For each recommendation, click **Stage** (or **Stage all**). Each one is
   tagged with a confidence (high / medium / low).
#. The staged changes appear in the draft bar. **Nothing is written to the
   aircraft** until you **Write all** there, through the normal verified-write
   path. Then re-fly and repeat.

.. note::

   Log Tuning is advisory. It does the manual "read the log, place the notch,
   break the limit cycle" analysis, and you decide what to apply. Apply one
   change at a time so the next log clearly shows its effect.

For the underlying control theory and a recommended tuning order, see the
ArduPilot `tuning guide <https://ardupilot.org/copter/docs/tuning.html>`__ and
`Autotune <https://ardupilot.org/copter/docs/autotune.html>`__ pages.
