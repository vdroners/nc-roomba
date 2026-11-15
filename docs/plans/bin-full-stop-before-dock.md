# Stop before docking when the bin is full

The 960's dock sits under a bookshelf, so emptying the bin there is awkward.
When a mission ends (or heads home mid-clean) with a full bin, the bridge
pauses the robot where it is and Nextcloud tells the operator to empty it,
then press Home.

## Behaviour

- Trigger phases: `hmPostMsn`, `hmMidMsn`, `hmUsrDock` (raw), i.e. any
  returning-to-dock phase.
- Only when the bin reads `full`, and only when the setting
  `stop_before_dock_when_bin_full` is on (default on).
- Action is `pause` (not `stop`) so the operator can still send Home.
- Once per mission: a flag is set when the pause is sent and cleared when a
  new cleaning cycle starts. After the pause, a user Home / Dock command is
  not intercepted.
- User-initiated dock is also skipped when `cycle === 'dock'` or when the
  last command this mission was `dock` (app, button, or physical dock).

## Where it lives

- Decision and pause: bridge `RobotManager` (it sees MQTT first).
- Setting: stored in the bridge config file (`/data/bridge-config.json` in
  production, next to the mission journal), exposed on GET/POST `/preferences`
  as `stop_before_dock_when_bin_full`, and shown in the Settings view.
- Notification: the state DTO carries a `bin_full_stop` event (`seq`, `fired`,
  `at`). `MissionService::ingestState` fires Notify + Activity once per seq.
