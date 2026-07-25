# NC Roomba

![version](https://img.shields.io/badge/version-0.3.0-C4A574)
![license](https://img.shields.io/badge/license-AGPL--3.0--or--later-1a1a1c)

Nextcloud app to control a Roomba over the **local LAN MQTT API**.
Remote access is via your Nextcloud URL; the private Node bridge never
binds a public port.

The UI brands itself around the **robot’s display name** (e.g. Alfred on
this install) with a butler-style charcoal / brass / cream look, a live
mission stage on the Dashboard, and an advanced Location map when the
robot publishes pose.

## Features

- **Factory Soft-AP setup wizard** (960/980 class) — join home Wi‑Fi without the iRobot app
- Start / pause / resume / stop / dock / spot / find
- Auto discover (LAN `:8883` scan + UDP) for IP / BLID
- Live status strip (battery, bin, Wi‑Fi, phase)
- **Mission stage** — realtime phase animation + coverage / duration counters
- Location map with trail + heading when pose is available; mission theater fallback otherwise
- Mission history from install (local only)
- Schedule week editor, preferences, retention
- Error decoder, maintenance hints, connection health drawer
- Nextcloud Notifications + Activity

## Stack

```
Browser ──► Nextcloud (nc_roomba PHP + Vue)
                │
                ▼  Docker DNS (nc_roomba_bridge:8080)
         nc-roomba-bridge (Node + dorita980)
           │                │
           │                ▼  host.docker.internal:8091
           │         nc-roomba-wifi-helper (Soft-AP)
           ▼  TLS MQTT :8883 (LAN only)
         Roomba
```

- Nextcloud app (`nc_roomba`) — Vue 2.7 + Pinia + PHP 8.1+
- Sidecar `nc-roomba-bridge` — Node + [dorita980](https://github.com/koalazak/dorita980)
- Host helper `wifi-helper/` — Soft-AP Wi‑Fi provision (systemd)
- Deploy target: `cloud_app` → `/var/www/html/custom_apps/nc_roomba`

## Quick start

```bash
cd /media/4TB/nc-roomba
npm ci
make helper-install                 # Soft-AP wifi helper + token in .env
# Real robot (not mock):
#   echo 'ROOMBA_MOCK=0' >> .env
#   echo 'ROBOT_IP=10.0.0.242' >> .env
#   echo 'ROOMBA_DISCOVER_SUBNETS=10.0.0.0/24' >> .env
ROOMBA_MOCK=0 make ship RESTART=1   # build + bridge-up + deploy + gate-preflight
make gate-gui
make gate-live ROOMBA_MOCK=1        # live gates without a robot
```

Admin: Nextcloud → Administration → NC Roomba → **Factory setup wizard**
(Soft-AP). Advanced: Auto discover + hold HOME. Operators must be in the
`roomba-operators` group.

### Important env / networking notes

| Item | Value |
|---|---|
| Bridge URL (from `cloud_app`) | `http://nc_roomba_bridge:8080` (underscores; hyphen alias also works) |
| Mock mode | `ROOMBA_MOCK=1` (compose default) vs `ROOMBA_MOCK=0` for a real robot |
| Discover subnets | `ROOMBA_DISCOVER_SUBNETS` (CIDR list, default `10.0.0.0/24`) |
| Soft-AP helper | `ROOMBA_WIFI_HELPER_URL` / `ROOMBA_WIFI_HELPER_TOKEN` |
| fw2 TLS | Roomba 960 needs the bridge TLS shim (`bridge/lib/tlsLegacy.js`) — already baked in |

## Docs

- Operator notes: [`docs/OPERATOR.md`](docs/OPERATOR.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Contributing / gates: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Plan (v0.3 Soft-AP wizard): [`.cursor/plans/nc-roomba-softap-wizard-v0.3.md`](.cursor/plans/nc-roomba-softap-wizard-v0.3.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## License

AGPL-3.0-or-later. Bridge dependency dorita980 is MIT.
