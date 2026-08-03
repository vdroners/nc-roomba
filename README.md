# NC Roomba

![version](https://img.shields.io/badge/version-0.12.0-C4A574)
![license](https://img.shields.io/badge/license-AGPL--3.0--or--later-1a1a1c)

Nextcloud app to control a Roomba over the **local LAN MQTT API** — no iRobot
cloud in the control path. Remote access is via your Nextcloud URL; the private
Node bridge never binds a public port.

The UI brands itself around the **robot's display name** (Alfred on this
install) with a butler-style charcoal / brass / cream look, a live mission stage
on the Dashboard, and a Location map when the robot publishes pose.

Tested on a **Roomba 960 (firmware 2)** against **Nextcloud 34 / PHP 8.5**.

## Features

- Start / pause / resume / stop / dock / find (`spot` is **not** supported —
  dorita980 implements no spot command and the robot answers 501)
- Hold-HOME credential retrieval — BLID + local MQTT password with **no iRobot app**
- **Factory Soft-AP setup wizard** (960/980 class) — best-effort fallback, *not*
  the recommended path: a 960's Soft-AP frequently associates but serves no
  setup service, so provisioning stalls. See
  [`docs/OPERATOR.md`](docs/OPERATOR.md) — hold-HOME is the path that works
- Auto discover (LAN `:8883` scan + UDP) for IP / BLID
- Live status strip (battery, bin, Wi‑Fi, phase) with a clear banner when
  Nextcloud cannot reach the bridge, rather than blank readings
- **Mission stage** — realtime phase animation + coverage / duration counters
- Location map with a swept-area footprint and heading when pose is available;
  mission theater fallback otherwise
- **Mission history** — see *How missions are recorded* below
- Schedule week editor; device preferences that report whether the **robot**
  confirmed the change, not merely that it was sent
- **30 achievements**, four of them scored from the install baseline so they
  measure what this app actually witnessed rather than the robot's whole life
- Error decoder, maintenance hints, connection health drawer
- Nextcloud Notifications + Activity
- Optional **Alfred** (OpenClaw) Talk integration: `@alfred roomba status |
  clean | pause | resume | dock | find | stop | help`, plus a five-minute monitor
  that posts bin-full / error / offline transitions to a Talk room

## Stack

```
Browser ──► Nextcloud (nc_roomba PHP + Vue)
                │
                ▼  Docker DNS (nc_roomba_bridge:8080)
         nc-roomba-bridge (Node + dorita980)
           │        │              │
           │        │              ▼  /data/missions.json (named volume)
           │        │         completed-mission journal
           │        ▼  host.docker.internal:8091
           │   nc-roomba-wifi-helper (Soft-AP, loopback + docker0 only)
           ▼  TLS MQTT :8883 (LAN only)
         Roomba
```

- Nextcloud app (`nc_roomba`) — Vue 2.7 + Pinia + PHP 8.1+ (no upper bound; see
  *Dependency caps* below)
- Sidecar `nc-roomba-bridge` — Node + [dorita980](https://github.com/koalazak/dorita980)
- Host helper `wifi-helper/` — Soft-AP Wi‑Fi provision (systemd, root, refuses
  to start without a token)
- Deploy target: `cloud_app` → `/var/www/html/custom_apps/nc_roomba`

## How missions are recorded

Three layers, because none is sufficient alone. Worth understanding, because the
history was silently empty for the whole life of the project before 0.10.0.

1. **The bridge is the authority.** It holds the MQTT session, so it sees the
   exact moment a cycle starts and stops. It journals each completed mission to a
   **persisted** ring buffer (`GET /missions?since=<seq>`) which Nextcloud drains
   on its own schedule. Nextcloud can be slow, restarted, or down for a day
   without losing one.
2. **Odometer safety net.** If the robot's own lifetime counter advances further
   than the missions recorded, a run happened nobody witnessed. It is stored with
   `source: odometer` and null boundaries rather than inventing times.
3. **Periodic sampling** fills in live phase events.

Rows record which layer produced them, so an unobserved mission is never
presented as a measured one. Nextcloud cron samples roughly every five minutes,
which is why layers 1 and 2 exist: a 28-minute mission can otherwise fall
entirely between two samples.

## Quick start

```bash
cd /media/4TB/nc-roomba
npm ci
make helper-install                 # Soft-AP wifi helper + token in /etc + .env
# Real robot (not mock):
#   echo 'ROOMBA_MOCK=0' >> .env
#   echo 'ROBOT_IP=10.0.0.242' >> .env
#   echo 'ROOMBA_DISCOVER_SUBNETS=10.0.0.0/24' >> .env
make ship                           # build + bridge-up + deploy + preflight + gui gates
make gate-live                      # safe: refuses the destructive gates on a real robot
```

Admin: Nextcloud → Administration → NC Roomba. Start with **Advanced → Auto
discover → Retrieve credentials (hold HOME)** — the reliable path for a robot
already on Wi‑Fi. The **Factory setup wizard** (Soft-AP) is the fallback for a
robot that cannot be provisioned any other way, and is known to stall on the
960; see [`docs/OPERATOR.md`](docs/OPERATOR.md). Operators must be in the
`roomba-operators` group.

> `make gate-live` reads mocked-ness **from the bridge**, not from the
> environment, and skips every mutating gate against a real robot. It used to
> take `ROOMBA_MOCK=1` and ignore it, so running it would start a real cleaning
> mission and overwrite the weekly schedule. To run those gates deliberately:
> `ROOMBA_ALLOW_LIVE_ROBOT=1 make gate-live`.

### Important env / networking notes

| Item | Value |
|---|---|
| Bridge URL (from `cloud_app`) | `http://nc_roomba_bridge:8080` (underscores; hyphen alias also works) |
| **Cron must reach the bridge** | `cloud_cron` **and** `cloud_app` must both be on `nc-roomba-net`. Background jobs run in the cron container, and they are the only writer of mission history — see the warning below |
| Mock mode | `ROOMBA_MOCK=1` (compose default) vs `ROOMBA_MOCK=0` for a real robot |
| Discover subnets | `ROOMBA_DISCOVER_SUBNETS` (CIDR list, default `10.0.0.0/24`) |
| Soft-AP helper | `ROOMBA_WIFI_HELPER_URL` / `ROOMBA_WIFI_HELPER_TOKEN` (required — the helper exits rather than run unauthenticated) |
| Helper bind | `127.0.0.1` + the docker gateway; override with `ROOMBA_WIFI_HELPER_BIND` |
| Mission journal | `ROOMBA_MISSION_LOG=/data/missions.json` on the `nc_roomba_bridge_data` volume |
| fw2 TLS | The 960 needs the bridge TLS shim (`bridge/lib/tlsLegacy.js`) — already baked in |

> ⚠️ **`docker network connect` does not survive a container recreate.** Any
> `docker compose up` on the cloud stack used to detach `cloud_app` and `cloud_cron`
> from `nc-roomba-net`. When that happens the app shows a "can't reach the robot"
> banner and mission history stops being written — silently, because from
> Nextcloud's point of view the bridge simply is not there. `make bridge-up`
> reattaches both and `make bridge-net-check` fails loudly if either cannot reach
> the bridge. **Durable fix:** `/media/4TB/cloud/docker-compose.yml` declares
> `nc-roomba-net` (and `nc-litter-net`) as external networks on `cloud_app` and
> `cloud_cron`, so recreates keep bridge DNS. The ops container-watchdog remains
> a belt-and-suspenders re-attach every five minutes.

### Dependency caps

`info.xml` deliberately declares **no PHP upper bound**. `occ upgrade`
re-validates an app's dependencies on every version bump, so a stale cap fails
that check and puts the **entire Nextcloud instance** into maintenance mode —
every app, every user — over a runtime we do not control. That happened when the
image moved to PHP 8.5 while this declared `max-version="8.4"`. `make
gate-preflight` now fails on any PHP cap.

The Nextcloud cap *is* meaningful (a major release can break APIs), but note it
currently reads `max-version="34"` and 34 is what runs — so the next Nextcloud
major will disable the app until it is tested and the cap raised. Preflight warns
about this.

## Testing

```bash
make gate-preflight   # layout, dependency caps, version sync, then all suites
make run-phpunit                       # 37 tests
cd bridge && npm test                  # 37
cd wifi-helper && npm test             # 23
npx vitest run                         # 62
make gate-gui                          # 24 GUI source gates
make gate-live                         # against the real robot, non-destructively
```

`make run-phpunit` uses the `php:8.2-cli` image, but the app is served by PHP
8.5 — run the suite against 8.5 too when touching PHP:

```bash
docker run --rm -v "$PWD:/app" -w /app php:8.5-rc-cli php vendor/bin/phpunit
```

The bridge action test binds to the **installed** dorita980 rather than a mock,
and fails both when a command we advertise is missing and if `spot` ever becomes
available. A fake robot that implemented `spot` is why a permanently-501 button
shipped.

## Docs

- Operator notes: [`docs/OPERATOR.md`](docs/OPERATOR.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Improvements tour: [`docs/REVIEW.md`](docs/REVIEW.md)
- Contributing / gates: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Plans: [`docs/plans/`](docs/plans/) — most recently
  [`nc-roomba-v0.10-history-and-audit.md`](docs/plans/nc-roomba-v0.10-history-and-audit.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## License

AGPL-3.0-or-later. Bridge dependency dorita980 is MIT.
