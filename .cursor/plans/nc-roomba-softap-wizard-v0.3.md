# NC Roomba Soft-AP factory wizard (v0.3.0)

## Goal

Factory-reset Roomba (fw2 Soft-AP / 960–980 class) → home Wi‑Fi → encrypted
credentials → local MQTT, without the iRobot phone app. Admin UI hosts a
stepper; advanced hold-HOME remains as fallback.

## Architecture

- **Host helper** `wifi-helper/` (`nc-roomba-wifi-helper.service` on `:8091`)
  owns Wi‑Fi Soft-AP join/leave + kumy MQTT `wlcfg` provision. Ethernet stays
  the default route.
- **Bridge** proxies Soft-AP scan/provision/status and rediscovers on LAN.
- **PHP** stores `home_wifi_*` (password encrypted) and upserts robot row.
- **Admin** `SetupWizard.vue` steppers Name → Wi‑Fi → Soft-AP → Provision → LAN → Done.

## Soft-AP operator sequence

1. CLEAN until all lights (factory path)
2. HOME + SPOT until melody / green Wi‑Fi blink
3. Wizard Scan → select `Roomba-<BLID>`
4. Wait for spoken “connected to Roomba” after host joins
5. Provision pushes SSID (hex) + pass → `wactivate` → `uap:false`
6. LAN discover + MQTT connect; DHCP reservation recommended

## Verification

- `cd wifi-helper && npm test`
- `cd bridge && npm test` (includes softap mock tests)
- `make ship RESTART=1` + helper systemd installed
- Live Soft-AP dogfood: `scripts/softap-dogfood.js` when robot Soft-AP is up

## Out of scope

- BLE / cloud provisioning for newer iRobot models
- Multi-robot concurrent Soft-AP
