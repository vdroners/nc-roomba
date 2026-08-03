# Install NC Roomba

NC Roomba is a Nextcloud app plus a companion MQTT bridge container. Strangers
(and App Store installs) should run the **published** bridge image from GHCR;
developers may still build from `bridge/`.

## Prerequisites

- Nextcloud 28–34 with PHP ≥ 8.1 (Docker `cloud_app` / `cloud_cron` or equivalent)
- Docker + `docker compose` on the host
- A Roomba on the same LAN as the bridge (after Wi‑Fi join)
- Node.js 20+ only if you build the frontend from source

## 1. Start the MQTT bridge (published image)

From a checkout of this repo (or a compose snippet you keep next to Nextcloud):

```bash
cp .env.example .env
# Edit .env: ROOMBA_MOCK=0, ROBOT_IP, and (after onboarding) BLID / PASSWORD

docker compose -f docker-compose.bridge.yml pull
docker compose -f docker-compose.bridge.yml up -d
```

`docker-compose.bridge.yml` defaults to
`ghcr.io/vdroners/nc-roomba-bridge:latest` (override with
`NC_ROOMBA_BRIDGE_IMAGE=...`). For local development, set
`NC_ROOMBA_BRIDGE_BUILD=1` or build with `docker compose … build`.

Create / reuse the Docker network and attach Nextcloud containers so PHP can
resolve the bridge by DNS:

```bash
docker network create nc-roomba-net 2>/dev/null || true
docker network connect nc-roomba-net cloud_app
docker network connect nc-roomba-net cloud_cron   # required for mission history jobs
```

Verify from inside Nextcloud:

```bash
docker exec cloud_app curl -s http://nc_roomba_bridge:8080/health
# → {"ok":true,...}
```

Bridge URL for Admin settings: `http://nc_roomba_bridge:8080`
(alias `nc-roomba-bridge` also resolves).

## 2. Install / enable the Nextcloud app

**App Store (when published):** install `nc_roomba` from the Nextcloud Apps page,
then set the bridge URL as above.

**From source / tarball:**

```bash
# into custom_apps/nc_roomba (or: make deploy when developing against cloud_app)
docker exec -u www-data cloud_app php /var/www/html/occ app:enable nc_roomba
docker exec -u www-data cloud_app php /var/www/html/occ upgrade
```

Add operators to the `roomba-operators` group (name configurable in Admin).

## 3. Onboard the robot (no day-to-day iRobot cloud)

1. Prefer **hold HOME → Retrieve credentials** in Administration → NC Roomba
   once the robot is already on home Wi‑Fi (DHCP reservation recommended).
2. Force-quit the iRobot mobile app (one MQTT client only).
3. **Test connection**, then use the Dashboard.

Privacy: after onboarding, control stays on **local MQTT**. This stack does not
call the iRobot cloud for cleaning or telemetry.

## 4. Optional: Soft-AP wifi-helper (factory Wi‑Fi join)

Only needed to push home Wi‑Fi onto a factory Soft-AP robot without the phone
app. Prefer hold-HOME onboarding when the robot is already online.

1. Install `wifi-helper/` on the **host** that owns a Wi‑Fi radio (not inside
   Docker). Paths and interface are **parameters** — do not assume a lab path
   or a specific iface name.
2. Create `/etc/nc-roomba-wifi-helper.env`:

```bash
ROOMBA_WIFI_HELPER_TOKEN=<random hex>
ROOMBA_WIFI_IFACE=wlan0          # your host Wi-Fi interface (iw / nmcli)
ROOMBA_WIFI_HELPER_DIR=/opt/nc-roomba/wifi-helper
# optional: NODE_BIN=/usr/bin/node
```

3. Install the unit from `wifi-helper/systemd/nc-roomba-wifi-helper.service`
   (it reads `ROOMBA_WIFI_HELPER_DIR` / `NODE_BIN` from the env file). Enable
   and start the service; it binds loopback + docker bridge only (not LAN).
4. Set `ROOMBA_WIFI_HELPER_URL` / `ROOMBA_WIFI_HELPER_TOKEN` in the bridge
   `.env` and recreate the bridge container.

From a checkout you can also run
`ROOMBA_WIFI_IFACE=wlan0 make helper-install` (requires sudo).

## 5. Verify

```bash
curl -s http://127.0.0.1:18791/health   # host-mapped bridge port (loopback only)
# In-app: Dashboard loads, Clean / Dock work, History records after a mission
```

Operator details: [docs/OPERATOR.md](docs/OPERATOR.md). Architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Troubleshooting

- Cron cannot resolve `nc_roomba_bridge` → mission history stays empty. Re-run
  `docker network connect nc-roomba-net cloud_cron` after recreating the cloud
  stack (attachments do not survive recreate unless declared in cloud compose).
- MQTT conflict → close the iRobot app, wait ~30s, retry connect.
- Soft-AP silent / beacon-only on some 960 units → use hold-HOME LAN takeover
  instead of factory Soft-AP.
