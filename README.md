# NC Roomba

**Version 0.1.2**

Nextcloud app to control Alfred (Roomba 960) over the local LAN MQTT API.
Remote access is via your Nextcloud DDNS URL; the private Node bridge never
binds a public port.

## Features

- Start / pause / resume / stop / dock / spot / find
- Auto discover (LAN `:8883` scan + UDP) for Alfred’s IP / BLID
- Live status strip (battery, bin, Wi‑Fi, phase)
- Mission history from install (local only)
- Schedule week editor, preferences, retention
- Error decoder, maintenance hints, connection health drawer
- Nextcloud Notifications + Activity

## Stack

- Nextcloud app (`nc_roomba`) — Vue 2.7 + Pinia + PHP 8.1+
- Sidecar `nc-roomba-bridge` — Node + [dorita980](https://github.com/koalazak/dorita980)
- Deploy target: `cloud_app` → `/var/www/html/custom_apps/nc_roomba`

## Quick start

```bash
cd /media/4TB/nc-roomba
npm ci
make ship RESTART=1          # build + bridge-up + deploy + gate-preflight
make gate-live ROOMBA_MOCK=1 # live gates without a robot
```

Admin: Nextcloud → NC Roomba settings → onboard Alfred (DHCP reservation +
hold HOME for BLID/password). Operators must be in the `roomba-operators` group.

## Docs

- Plan: [`docs/plans/nc-roomba-v0.1.0.md`](docs/plans/nc-roomba-v0.1.0.md)
- Operator notes: [`docs/OPERATOR.md`](docs/OPERATOR.md)

## License

AGPL-3.0-or-later. Bridge dependency dorita980 is MIT.
