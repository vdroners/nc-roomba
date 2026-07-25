# NC Roomba onboarding-findings integration (v0.4.0)

## Why

Live onboarding of a real Roomba 960 (Alfred, SKU R960020) revealed the
Soft-AP factory path is unreliable on the 960: it associates at Wi‑Fi L2 but
its Soft-AP setup service frequently serves no IP stack (no DHCP, no ARP/MQTT
at `192.168.10.1`), even after factory reset and battery pull. The reliable
route that actually put Alfred under NC-Roomba control was:

1. Robot already on home Wi‑Fi (via iRobot app once, or any prior provision).
2. **Hold HOME until it beeps**, then bridge `get-password` (dorita980
   handshake to `<ip>:8883`) retrieves BLID + local MQTT password — no app.
3. Store creds (encrypted DB via the app, and/or `.env` for bridge
   auto-connect) → connect. Restart re-connects with zero manual steps.

The app should teach the reliable path first and keep Soft-AP as a clearly
labelled fallback with the 960 gotchas we found.

## What changes

- **`docs/REVIEW.md`** (new): human-readable summary of every improvement
  0.1.0 → 0.3.2 plus Alfred's current live state and how to review it.
- **`docs/OPERATOR.md`**: reorder onboarding — lead with the hold-HOME LAN
  takeover (reliable, app-free once on Wi‑Fi); demote Soft-AP to "fallback"
  with the documented 960 setup-service fault + full-minute battery-pull
  recovery. Add the `.env` auto-connect persistence note and the
  `battery=0 / not_ready=15 = not docked` telemetry note.
- **`src/components/SetupWizard.vue`**: header note that the LAN hold-HOME path
  (Advanced) is preferred when the robot is already on Wi‑Fi; Soft-AP step
  gains the 960 caveat + battery-pull tip.
- **`src/views/AdminSettingsView.vue`**: promote the hold-HOME/Auto-discover
  block with a short "recommended if already on Wi‑Fi" note.
- Version bump to 0.4.0 (new-feature/behaviour docs+UX), CHANGELOG entry.

## Verification

- `make build` exits 0.
- `make deploy` into `cloud_app`; admin page renders the new guidance.
- Alfred still shows connected (`/state` connected:true) after deploy.
- No secret committed (`.env` stays gitignored; creds only in REVIEW.md as the
  method, not the literal password).
