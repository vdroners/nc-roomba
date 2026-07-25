# NC Roomba v0.2 — Butler UI + production polish

## Decisions

- Butler look: charcoal / brass / cream
- UI naming keyed to live robot display name (product stays NC Roomba)
- Split Dashboard: ControlPad + MissionStage; Location gets advanced map when pose exists

## Delivered

- `img/app.svg` Roomba + HOME ring mark (replaces wrong printer icon)
- Butler tokens + stage / map motion in `css/style.scss`
- `MissionStage.vue` + Dashboard split; AppShell `is-cleaning` atmosphere
- Location trail / dock / heading cone + no-pose mission theater
- De-Alfreded operator copy; multi-robot appinfo summary
- README, OPERATOR, ARCHITECTURE, CONTRIBUTING, issue templates
- Version **0.2.0**

## Verify

- `make gate-preflight && make gate-gui && npm test && make bridge-test`
- Browser: Dashboard idle vs cleaning (mock); Location fallback for 960
