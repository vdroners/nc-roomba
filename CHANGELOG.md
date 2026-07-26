# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.2] - 2026-07-25

### Changed

- **Operator Settings tab no longer carries admin-only tools.** Robot Auto-
  discover, hold-HOME onboarding and data-retention prune were duplicated in the
  operator Settings view; they now live solely in Administration → NC Roomba
  (where they already existed). Settings keeps the schedule and cleaning
  preferences and points admins to the admin page for the rest.

### Fixed

- More clipping hardening: list titles/meta (long BLID/IP strings) now wrap
  with `overflow-wrap` instead of overflowing their row.

## [0.5.1] - 2026-07-25

### Fixed

- **UI felt frozen and needed a manual browser refresh.** SSE can stay "open"
  behind a buffering proxy while no frames actually arrive. The store now runs a
  slow background poll (6 s) alongside SSE as a safety net, drops to a faster
  3 s poll the moment SSE errors (was: only after 2 failures), and refreshes
  immediately when the tab regains focus/visibility. Data stays live without a
  reload.
- **Labels and values clipped out of their boxes.** Status-strip chips forced a
  single line with no overflow handling, and stat / mission-metric values had no
  wrapping. Chips now cap to the row width and wrap long labels; stat and metric
  values wrap (`overflow-wrap` + `min-width:0`) instead of spilling past their
  borders (e.g. firmware strings, large coverage numbers).

## [0.5.0] - 2026-07-25

### Fixed

- **App tabs could not be scrolled** — the main content region was a flex child
  with no `overflow-y`, so anything below the fold was unreachable. The shell now
  bounds its height and `.nc-roomba-main` owns a real scroll region
  (`overflow-y:auto; min-height:0`); the status strip and nav stay pinned above.
- **Battery showed a red 0% while charging.** A freshly power-cycled robot
  reports `batPct: 0` until the BMS recalibrates over the first charge cycle.
  `batteryLabel`/`batteryClass` are now phase-aware: 0% during `charge` renders
  as a neutral "Charging…" instead of a critical reading (normal buckets
  unchanged when a real percentage is reported).

### Added

- **Dock / ready chip** in the status strip decoding phase + `not_ready` into
  "On dock / Off dock / Not ready" instead of a raw bitfield.
- **Charging-calibration hint** on the mission stage explaining the 0%-while-
  charging behavior so it does not read as a fault.
- **"About the robot" identity card** and richer lifetime stats in Maintenance:
  model (`sku`), firmware (`software_version`), mission success rate, average
  mission length, and cliff-pick / panic counts — all from data the robot
  already reports.

### Changed

- **Onboarding hardened for repeatable setup.** `onboard()` now names the robot
  from the value it reports (`robotname`) instead of hardcoding "Alfred", stores
  its model `sku`, and maps get-password failures to actionable messages
  (not-in-onboarding → hold HOME; ECONNREFUSED → close the iRobot app;
  unreachable → check Wi-Fi/IP) rather than a generic `get_password_failed`.

## [0.4.0] - 2026-07-25

### Changed

- **Onboarding guidance reordered around what actually works.** Live onboarding
  of a Roomba 960 (Alfred) showed the Soft-AP factory path is unreliable on the
  960 — it associates at Wi-Fi L2 but often serves no setup service (no DHCP /
  MQTT at `192.168.10.1`), even after factory reset. The reliable, app-free
  route is: get the robot on Wi-Fi (iRobot app once, if needed), then
  **hold HOME → Retrieve credentials** over the LAN. The admin page now opens
  and leads with Auto-discover + hold-HOME (a success NoteCard), and the Soft-AP
  wizard is labelled a fallback.
- `docs/OPERATOR.md` leads with the hold-HOME LAN takeover; Soft-AP is the
  fallback with the 960 setup-service caveat and full-minute battery-pull
  recovery. Added a troubleshooting row for `battery 0 / not_ready 15` = robot
  off the dock (not a connection fault) and for the 960 "gateway never
  responded" Soft-AP case.

### Added

- `docs/REVIEW.md` — a plain-language tour of every improvement (0.1.0 → 0.4.0),
  Alfred's current live state, and how to review the app yourself.
- SetupWizard shows the 960 Soft-AP caveat + battery-pull tip and points to the
  hold-HOME path when the robot is already on Wi-Fi.
- Documented `.env` `BLID` / `PASSWORD` / `ROBOT_IP` as the headless
  auto-reconnect persistence for the bridge (verified across a container
  recreate).

## [0.3.2] - 2026-07-25

### Fixed

- Soft-AP join reported success without actually associating: `iw connect` returns
  as soon as the request is queued, so the link could stay `NO-CARRIER` while the
  helper went on to assign the static IP and ping the gateway. `joinSoftAp` now
  calls a new `waitAssociated()` that polls `iw dev <iface> link` for the real
  "Connected to" carrier before proceeding, and disconnects + retries on failure.
  Verified live against a Roomba 960 Soft-AP: association is now solid (was 0%).
- Host Wi-Fi regulatory domain was left at the unset `country 00`, which throttles
  channel-1 TX power enough that association to a weak open Soft-AP can silently
  fail. `ensureRadioUp()` now runs `iw reg set US` (override via
  `ROOMBA_WIFI_REGDOM`) and disables power-save for the short-lived Soft-AP session.

### Added

- Request-level logging in the Wi-Fi helper (`--> METHOD /path` / `<-- ... status
  ms`, body never logged since it carries the home Wi-Fi password) so live Soft-AP
  attempts are debuggable from `journalctl -u nc-roomba-wifi-helper`.

## [0.3.1] - 2026-07-25

### Fixed

- Wi-Fi scanning returned zero networks after any Soft-AP session: `leaveSoftAp`
  handed the radio back to NetworkManager while the link was down, and every later
  `nmcli device wifi list` came back empty. The helper now restores managed + up on
  leave, and `ensureRadioUp()` runs before every scan and join with a 3-pass retry.
- `joinSoftAp` only computed a centre frequency for channel 1, so a Soft-AP on any
  other channel was passed to `iw` with no frequency hint. Added `channelToFreq`.
- Soft-AP discovery only matched `Roomba-<BLID>`; Braava and some newer units
  advertise `iRobot-<BLID>`. Both prefixes are now accepted for scan and BLID parse.
- `authExchangePacket` wrote the MQTT remaining-length as a single byte, which
  corrupts the packet above 127 bytes. Now uses proper varint encoding.
- Post-provision LAN discovery fell back to `candidates[0]` when no BLID matched,
  which could target a different robot. It now requires a BLID match or a lone
  candidate, and polls 4 times (robots take 15-60 s to join home Wi-Fi).

### Added

- `occ nc_roomba:home-wifi` to show or seed the home Wi-Fi SSID / passphrase /
  timezone / country headlessly; the passphrase is encrypted at rest as the admin
  UI would store it.
- `home_wifi_password` listed in `AdminSecretCrypto::SECRET_KEYS`.

## [0.3.0] - 2026-07-25

### Added

- **Factory Soft-AP setup wizard** in Administration → NC Roomba (name, home Wi‑Fi,
  Soft-AP scan, provision, LAN connect)
- Host service `nc-roomba-wifi-helper` (`wifi-helper/`) for Soft-AP join + kumy
  MQTT `wlcfg` provisioning without the iRobot app
- Bridge APIs `/onboard/softap-scan`, `/onboard/softap-provision`, `/onboard/softap-status`
- PHP admin routes `/api/admin/setup/softap*`; encrypted `home_wifi_password` appconfig
- Dogfood script `scripts/softap-dogfood.js` and plan
  `.cursor/plans/nc-roomba-softap-wizard-v0.3.md`

### Fixed

- Admin UI now recognizes `has_password` (was looking only for `password_set`)

### Changed

- Operator guide leads with Soft-AP factory path; hold-HOME is advanced fallback

## [0.2.0] - 2026-07-25

### Added

- Butler visual system (charcoal / brass / cream) and unique Roomba app icon
- **Mission stage** on the Dashboard — live phase animation, coverage / duration /
  battery / cycle metrics, optional pose mini-map
- Advanced Location map (dock origin, fading trail, heading cone) when pose exists;
  mission-theater fallback when it does not (e.g. Roomba 960)
- Production docs: `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, GitHub issue templates
- Checked-in plan `.cursor/plans/nc-roomba-butler-ui-v0.2.md`

### Changed

- Operator-facing copy uses the live robot display name (not hardcoded Alfred)
- App summary/description are multi-robot; Alfred remains the worked example in docs
- Dashboard is a Controls + MissionStage split; shell gains a cleaning atmosphere

## [0.1.2] - 2026-07-25

### Fixed

- **Bridge was unreachable from Nextcloud.** The default bridge URL used
  `nc-roomba-bridge` (hyphens) but the container/service resolves as
  `nc_roomba_bridge` (underscores), so every PHP → bridge call failed with
  `Could not resolve host`. Default fixed everywhere and a `nc-roomba-bridge`
  network alias added so previously-saved URLs keep working.
- **Live connection to fw2 robots (e.g. Roomba 960) failed silently.** Their
  old TLS stack lacks RFC 5746 secure renegotiation, which OpenSSL 3 (Node
  ≥ 17) refuses (`ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED`). Added a
  `tls.connect` shim (`bridge/lib/tlsLegacy.js`) that enables
  `SSL_OP_LEGACY_SERVER_CONNECT` + a workable cipher/`SECLEVEL` for the
  robot's `:8883` endpoint only.
- **Bridge crash-loop on connect errors.** dorita980 v2 attaches an `error`
  listener that rethrows, turning a benign auth/reconnect error into an
  uncaught exception that restarted the container. The manager now strips that
  listener and handles errors itself.
- Bad-credentials (MQTT CONNACK code 5) now surfaces a clear message pointing
  the operator at **Retrieve credentials (hold HOME)** instead of being
  mislabeled as a session conflict.

### Changed

- `docker-compose.bridge.yml` reads a `.env` for `ROOMBA_MOCK` / `ROBOT_IP` /
  `ROOMBA_DISCOVER_SUBNETS` (real mode requires `ROOMBA_MOCK=0`).

## [0.1.1] - 2026-07-25

### Added

- Working **Auto discover** on Settings + Admin (UDP + :8883 LAN scan)
- Discover finds Alfred even when UDP broadcast is silent

### Changed

- Settings: cleaning preferences are real controls (carpet boost, pass count,
  edge clean, always finish) instead of a raw JSON dump, and the admin-only
  retention panel can preview *and* apply a prune


## [0.1.0] - 2026-07-25

### Added

- Initial NC Roomba Nextcloud app (`nc_roomba`) for Alfred (Roomba 960)
- Local MQTT bridge sidecar (`nc-roomba-bridge`) using dorita980
- Dashboard controls: clean, spot, pause, resume, stop, dock, find
- Status strip, error decoder, mission timeline, schedule week grid
- Maintenance hints, connection health drawer, NC theme inheritance
- Mission history from install, CSV/JSON export, retention prune
- `roomba-operators` group ACL, encrypted robot password at rest
- Notifications + Activity for complete / error / bin / battery
- Gate suite: `gate-preflight`, `gate-live`, `gate-gui`
