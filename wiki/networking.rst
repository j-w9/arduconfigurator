Networking
==========

The **Networking** tab configures IP networking on flight controllers that
support it — static/DHCP addressing over Ethernet or PPP, and MAVLink/telemetry
served over UDP/TCP network endpoints. It also covers configuring **DroneNet**
peripherals over DroneCAN.

Where it is
-----------

Networking is an **Expert-mode** surface, and it only appears when the connected
flight controller actually reports networking parameters (the ``NET_*`` family).
Most flight controllers have no Ethernet or PPP hardware, so the tab is hidden on
them — switch on Expert mode (top-right) and, if the board supports networking,
the **Networking** tab appears in the sidebar.

The tab has two sub-tabs:

- **IP setup** — the flight controller's own networking (below).
- **DroneNet** — a DroneCAN peripheral's networking (further below).

.. note::

   Not every flight controller is Ethernet/PPP-capable. If the Networking tab
   is not shown, your board does not expose ``NET_`` parameters and there is
   nothing to configure here.

IP configuration
----------------

- **Networking** (``NET_ENABLE``) — master switch for the onboard IP stack.
- **DHCP client** (``NET_DHCP``) — request an address automatically, or disable
  it to use the static address below.
- **Static IP / Gateway / Subnet mask** — the board's address on the LAN. The
  subnet mask is entered as a **prefix length** (24 = ``255.255.255.0``), not a
  dotted quad.
- **MAC address** — leave the default unless your network requires a specific
  MAC.

Most of these take effect only after a **reboot**; the tab flags the pending
reboot when you apply them.

PPP (no native Ethernet)
------------------------

Boards without an Ethernet MAC run networking over **PPP** on a serial link. To
bring it up, set the carrying serial port's protocol to **PPP** on the Ports tab,
then enable **Networking**. On native-Ethernet boards, the *PPP Ethernet gateway*
option (in **Networking options**) bridges a PPP peer onto the Ethernet LAN.

Network endpoints
-----------------

Each endpoint turns a network socket into a serial stream carrying a protocol
(usually MAVLink): choose a **type** (UDP/TCP, client or server), a **protocol**,
and the **IP/port**. A UDP-client endpoint pointed at ``…​.255`` broadcasts on
the subnet — a common way to make telemetry discoverable on the LAN.

DroneNet peripherals
--------------------

A **DroneNet** node (for example an AP_Periph Ethernet-switch peripheral) provides
a network on the CAN bus side of the vehicle. Open the **DroneNet** sub-tab and the
configurator **auto-connects over the CAN bus** to look for peripherals — no manual
"Start" needed. Discovered nodes are listed; expand one and edit its network
(``NET_*``) parameters, then **Apply & Save** to write them to the node over
DroneCAN and persist them to its flash. You never have to leave for the CAN tab.

The full peripheral network parameter set is supported and labelled: IP addressing,
network endpoints (``NET_Pn_*``), the PPP link (``NET_PPP_*``), and serial↔network
**passthrough** (``NET_PASSn_*`` — bridge a node UART to a TCP/UDP endpoint on the
LAN). Under the hood these are ordinary DroneCAN parameter writes (the same
mechanism the CAN tab uses), presented as plain network settings.
