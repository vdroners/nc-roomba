# NC Roomba — Operator guide

Control your Roomba from Nextcloud over the local LAN MQTT API.
The Node bridge (`nc_roomba_bridge`) never binds a public port; browsers talk
only to Nextcloud. The UI uses the robot’s **display name** everywhere
(worked example below: **Alfred**, Roomba 960).

## Prerequisites

- Robot on the same LAN / VLAN as the Nextcloud host (after Soft-AP provision)
- Nextcloud admins configure the app; operators must be in the `roomba-operators` group
- Bridge container on Docker network `nc-roomba-net`, reachable from `cloud_app` as
  `http://nc_roomba_bridge:8080` (underscores; `nc-roomba-bridge` alias also resolves)
- Host Soft-AP helper: `nc-roomba-wifi-helper` on `:8091` (Wi‑Fi radio on the GCS host)
- For a **real** robot: bridge must run with `ROOMBA_MOCK=0` (see `.env`)

## 1. Factory Soft-AP setup (preferred — no iRobot app)

Supported on Soft-AP fw2 robots (Roomba 960 / 980 class). Newer BLE-only models
are out of scope.

1. Open **Administration → NC Roomba**.
2. **Wizard → Name** — set the display name (e.g. Alfred).
3. **Home Wi‑Fi** — 2.4&nbsp;GHz SSID + password (same LAN as `10.0.0.x` / the bridge).
   Password is stored encrypted for re-provision.
4. Put the robot in Soft-AP mode:
   - **CLEAN** until all lights flash (factory path), release
   - **HOME + SPOT** until melody + green Wi‑Fi blink
5. **Scan Soft-AP**, select `Roomba-<BLID>`, then **Start Soft-AP provision**.
   Wait for the spoken “connected to Roomba” after the host joins.
6. When provision finishes, reserve the discovered LAN IP on your router
   (DHCP reservation), then **Test connection**.
7. Force-quit the iRobot app if it is installed (single MQTT client).

CLI dogfood (host): `node scripts/softap-dogfood.js` with
`HOME_SSID` / `HOME_PASS` / `ROOMBA_WIFI_HELPER_TOKEN`.

## 2. DHCP reservation

1. Find the robot’s MAC on your router (or use **Auto discover** — it lists
   `robotname`, IP, and BLID from a LAN `:8883` scan).
2. Create a **DHCP reservation** so the robot always gets the same IPv4 address.
3. Confirm port **8883/tcp** is reachable from the host running the bridge:
   `nc -zv <robot-ip> 8883`

After Soft-AP (or phone) Wi‑Fi join we use **local MQTT only**. Close the iRobot
app when using NC Roomba (single MQTT connection).

## 3. Advanced: Auto discover + Hold-HOME

Use when the robot is already on LAN Wi‑Fi and you need to rotate the local password.

1. In **Administration → NC Roomba → Advanced**, click **Auto discover**.
2. On the robot, **press and hold HOME** (~2 seconds) until tones / Wi‑Fi pulse.
3. Click **Retrieve credentials (hold HOME)** — fetches the **local** MQTT password
   (not your iRobot account password), saves encrypted, then **Test connection**.

### Local password vs account password

MQTT `Not authorized` almost always means the stored password is wrong.
Use Soft-AP provision (new password) or **Retrieve credentials (hold HOME)** —
never paste the iRobot cloud login.

## 4. Operators

1. Create / use the Nextcloud group `roomba-operators` (configurable in admin).
2. Add users who may start/pause/dock the robot.
3. Open **NC Roomba** from the app menu (admins always have access).

## 5. Day-to-day

- **Clean / Spot / Pause / Resume / Dock / Find** from the control pad
- **Stop** asks for confirmation (destructive)
- **Dashboard** shows Controls + live **mission stage** (phase animation, coverage, duration)
- **Location** shows a pose map + trail when the robot publishes pose; otherwise
  the same mission stage so cleaning still feels live
- Status strip shows battery, bin, RSSI, phase, last-seen
- If MQTT conflicts, open the connection health drawer and follow the checklist
- Schedule editor uses robot-local week times (`setWeek`)
- Mission history accumulates locally; admins set retention days (default 365)

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Soft-AP scan empty | Robot not in HOME+SPOT Soft-AP | Re-enter Soft-AP; helper Wi‑Fi radio up |
| Soft-AP join but provision times out | IP stack not up / no spoken prompt | Wait for voice; retry; stay near robot |
| Helper unauthorized / 502 | Helper down or bad token | `systemctl status nc-roomba-wifi-helper`; check `.env` token |
| `Could not resolve host: nc-roomba-bridge` | Wrong DNS spelling | Use `http://nc_roomba_bridge:8080` (underscores) |
| Discover / onboard / test all fail | Bridge URL wrong or bridge down | Check admin Bridge URL; `docker ps` for `nc_roomba_bridge` |
| `Not authorized` | Wrong local password | Soft-AP re-provision or hold HOME → Retrieve |
| Conflict / cannot connect | iRobot app or second MQTT client | Close app; wait 30s; retry |
| Discover empty | Robot asleep / wrong subnet | Wake robot; set `ROOMBA_DISCOVER_SUBNETS` |
| get-password: not in onboarding mode | HOME not held / window expired | Re-hold HOME until tones; retry within ~60s |
| Connected=false, silent errors | Old bridge without TLS shim | Rebuild bridge (v0.1.2+ includes `tlsLegacy.js`) |
| Mock always “connected” | `ROOMBA_MOCK=1` | Set `ROOMBA_MOCK=0` and `make bridge-up` |
| Stale state | Bridge down | `curl` `/health` on Docker DNS |
| 403 on actions | Not in `roomba-operators` | Admin adds user to group |

## Security notes

- Robot password is stored only as `enc:v1:…` in the Nextcloud DB
- Bridge has no public publish; do not map host ports in production
- Do not stop unrelated services (e.g. `openclaw-gateway`)
