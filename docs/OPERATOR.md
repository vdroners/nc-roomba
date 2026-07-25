# NC Roomba — Operator guide

Control **Alfred** (Roomba 960) from Nextcloud over the local LAN MQTT API.
The Node bridge (`nc-roomba-bridge`) never binds a public port; browsers talk
only to Nextcloud.

## Prerequisites

- Alfred on the same LAN as the GCS / Nextcloud host
- Nextcloud admins configure the app; operators must be in the `roomba-operators` group
- Bridge container attached to Docker network reachable from `cloud_app` as `http://nc-roomba-bridge:8080`

## 1. DHCP reservation

1. Find Alfred’s MAC on your router (or use **Auto discover** in the app — it
   lists `robotname`, IP, and BLID from a LAN `:8883` scan).
2. Create a **DHCP reservation** so Alfred always gets the same IPv4 address.
3. Confirm port **8883/tcp** is reachable from the host running the bridge:
   `nc -zv <alfred-ip> 8883`

Tip: Keep the iRobot cloud Wi‑Fi association from the original phone setup; after
onboarding we use **local MQTT only** and you should close the iRobot app when
using NC Roomba (single MQTT connection).

## 2. Auto discover + Hold-HOME onboarding

Alfred must be on the dock / powered, on Wi‑Fi, and **not** connected to the
iRobot mobile app.

1. In **NC Roomba → Settings** (or **Administration → NC Roomba**), click
   **Auto discover**. The bridge tries UDP discovery, then TCP-scans
   `ROOMBA_DISCOVER_SUBNETS` (default `10.0.0.0/24`) for MQTT `:8883` and reads
   public info (name / BLID). Select **Alfred** when listed.
2. On Alfred, **press and hold the HOME button** until the robot plays a series
   of tones (dorita980 / get-password window — typically ~2 seconds hold, then
   wait while the bridge fetches credentials).
3. Click **Onboard (hold HOME)**. The bridge calls `getPassword`, stores BLID +
   password encrypted (`enc:v1:` + Nextcloud `ICrypto`), and opens the MQTT session.
4. Run **Connect test**. Success shows connected state; a **conflict** means
   another client (usually the iRobot app) holds the MQTT socket — close it,
   wait ~30s, retry.

## 3. Operators

1. Create / use the Nextcloud group `roomba-operators` (configurable in admin).
2. Add users who may start/pause/dock Alfred.
3. Open **NC Roomba** from the app menu (admins always have access).

## 4. Day-to-day

- **Clean / Spot / Pause / Resume / Dock / Find** from the control pad
- **Stop** asks for confirmation (destructive)
- Status strip shows battery, bin, RSSI, phase, last-seen
- If MQTT conflicts, open the connection health drawer and follow the checklist
- Schedule editor uses robot-local week times (`setWeek`); note server timezone may differ
- Mission history accumulates locally; admins set retention days (default 365)

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Conflict / cannot connect | iRobot app or second MQTT client | Close app; wait 30s; retry |
| Discover empty | Alfred asleep / wrong subnet | Wake robot; check DHCP IP |
| get-password timeout | HOME not held / wrong IP | Re-hold HOME; verify IP |
| Stale state | Bridge down | `docker ps` for `nc_roomba_bridge`; check `/health` on Docker DNS |
| 403 on actions | Not in `roomba-operators` | Admin adds user to group |

## Security notes

- Robot password is stored only as `enc:v1:…` in the Nextcloud DB
- Bridge has no public publish; do not map host ports in production
- Do not stop unrelated services (e.g. `openclaw-gateway`)
