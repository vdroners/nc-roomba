# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
