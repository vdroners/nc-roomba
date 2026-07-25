# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
