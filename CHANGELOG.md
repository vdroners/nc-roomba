# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
