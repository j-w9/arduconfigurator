ArduConfigurator Wiki
=====================

ArduConfigurator is a browser-first configurator for ArduPilot, for setup and
configuration. It is aimed at ArduCopter FPV workflows, and also supports Plane,
Rover and Sub. It runs in your browser over Web Serial, and a thin desktop
shell reuses the same app.

This wiki mirrors the structure of the `ArduPilot wiki <https://ardupilot.org/>`__
and the order of the app: connect, run the guided setup, then work through
each tab. If you are new, start with :doc:`introduction` and
:doc:`getting-connected`, then follow :doc:`guided-setup`.

.. note::

   This wiki documents the app: what each tab does and how to use it. For
   firmware concepts, flight theory and tuning background, the
   `ArduPilot documentation <https://ardupilot.org/>`__ is the canonical
   reference.

.. toctree::
   :maxdepth: 2
   :caption: Getting Started

   introduction
   getting-connected
   guided-setup

.. toctree::
   :maxdepth: 2
   :caption: First Time Setup

   first-time-setup/index

.. toctree::
   :maxdepth: 2
   :caption: Configuration & Tools

   config
   tuning
   parameters
   lua
   can-dronecan
   networking
   files
   logs-inspectors

.. toctree::
   :maxdepth: 1
   :caption: Reference

   reference
   parameters/index
   about
