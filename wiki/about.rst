About & Contributing
====================

ArduConfigurator is a browser-first configurator for ArduPilot — a setup- and
configuration-first tool in the same category as Betaflight Configurator, but
for ArduPilot and aimed at ArduCopter FPV workflows (and, increasingly, Plane,
Rover, and Sub). It runs entirely in your browser over Web Serial, with a thin
desktop shell that reuses the same app. This wiki documents the configurator;
see :doc:`introduction` to get started.

License
-------

ArduConfigurator is free software, licensed **GPL-3.0-only**. You are free to
use, study, share, and modify it under the terms of version 3 of the GNU General
Public License. Provenance and licensing are kept clear for any third-party code
or assets — for example, the craft 3D models bundled with the app are
GPL-sourced from Betaflight Configurator.

Contributing
------------

The project lives at `github.com/j-w9/arduconfigurator
<https://github.com/j-w9/arduconfigurator>`__. Contributions — issues, fixes,
and pages — are welcome.

This wiki's source is in the ``wiki/`` directory of that repository, written in
reStructuredText for Sphinx. Every page has an **Edit on GitHub** link, so the
quickest way to fix a typo or clarify a step is to follow that link, edit the
``.rst`` file, and open a pull request. Changes stay small and scoped, and the
repository's ``CONTRIBUTING.md`` describes the validation expectations for code
contributions.

Relationship to the ArduPilot wiki
----------------------------------

ArduConfigurator **complements** the ArduPilot wiki — it does not replace it.
This wiki documents the *configurator*: what each surface does and how to use
it. For the firmware itself — flight modes, tuning theory, parameter meanings,
hardware support, and flight behavior — the
`ArduPilot documentation <https://ardupilot.org/>`__ remains the canonical
reference, and these pages link to it wherever a topic crosses into firmware
territory.
