# NC-Roomba Agent Guide

| Path | Use |
|------|-----|
| `/media/4TB/nc-roomba` | This app (standalone) |
| `/media/4TB/nc-print` | Skeleton reference |
| `/media/4TB/nc-gcs` | Theme / ACL / crypto patterns (vendor, do not hard-depend) |

## Key services

| Service | Container / path |
|---------|------------------|
| Nextcloud | `cloud_app` → `custom_apps/nc_roomba` |
| Bridge | `nc_roomba_bridge` on Docker network `nc-roomba-net` |

## Common commands

```bash
cd /media/4TB/nc-roomba
make build
make bridge-up
make deploy RESTART=1
make gate-preflight
curl -s http://127.0.0.1:18791/health   # only if bridge published for debug — production binds Docker DNS only
```

Do not stop `openclaw-gateway`. Do not expose the bridge publicly.
