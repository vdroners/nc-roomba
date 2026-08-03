APP_ID ?= nc_roomba
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
CONTAINER ?= cloud_app
REMOTE := /var/www/html/custom_apps/$(APP_ID)
BRIDGE_COMPOSE := docker compose -f "$(ROOT)docker-compose.bridge.yml"
BRIDGE_NET := nc-roomba-net
DATE ?= $(shell date +%F)

.PHONY: build test deploy ship bridge-up bridge-down bridge-test bridge-net-check \
	bump-patch bump-minor gate-preflight gate-live gate-gui \
	phpunit run-phpunit helper-install helper-test helper-up helper-down \
	appstore appstore-sign

build:
	cd "$(ROOT)" && npm run build

bump-patch:
	@$(MAKE) --no-print-directory _bump PART=patch
bump-minor:
	@$(MAKE) --no-print-directory _bump PART=minor

_bump:
	@cur=$$(grep -oE '<version>[0-9]+\.[0-9]+\.[0-9]+</version>' "$(ROOT)appinfo/info.xml" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'); \
	test -n "$$cur" || (echo "could not read version" && exit 1); \
	maj=$$(echo $$cur | cut -d. -f1); min=$$(echo $$cur | cut -d. -f2); pat=$$(echo $$cur | cut -d. -f3); \
	if [ "$(PART)" = "minor" ]; then min=$$((min+1)); pat=0; else pat=$$((pat+1)); fi; \
	next="$$maj.$$min.$$pat"; \
	sed -i "s#<version>$$cur</version>#<version>$$next</version>#" "$(ROOT)appinfo/info.xml"; \
	sed -i "s#\"version\": \"$$cur\"#\"version\": \"$$next\"#" "$(ROOT)package.json"; \
	sed -i "s#\"version\": \"$$cur\"#\"version\": \"$$next\"#" "$(ROOT)bridge/package.json"; \
	sed -i "s#\"version\": \"$$cur\"#\"version\": \"$$next\"#" "$(ROOT)wifi-helper/package.json"; \
	if [ -f "$(ROOT)package-lock.json" ]; then \
		sed -i "0,/\"version\": \"$$cur\"/s##\"version\": \"$$next\"#" "$(ROOT)package-lock.json"; \
		sed -i "0,/\"version\": \"$$cur\"/s##\"version\": \"$$next\"#" "$(ROOT)package-lock.json"; \
	fi; \
	sed -i "s#\*\*Version $$cur\*\*#**Version $$next**#" "$(ROOT)README.md"; \
	if ! grep -q "^## \[$$next\]" "$(ROOT)CHANGELOG.md"; then \
		awk -v v="$$next" -v d="$(DATE)" 'BEGIN{done=0} /^## \[/ && !done {print "## [" v "] - " d "\n"; done=1} {print}' \
			"$(ROOT)CHANGELOG.md" > "$(ROOT)CHANGELOG.md.tmp" && mv "$(ROOT)CHANGELOG.md.tmp" "$(ROOT)CHANGELOG.md"; \
	fi; \
	echo "Bumped $$cur -> $$next"

# Prefer `.env` (ROOMBA_MOCK=0 for a real robot). Do NOT export ROOMBA_MOCK=1
# here — a shell override wins over `.env` and silently puts the bridge into mock.
# Containers that must be able to resolve the bridge.
#
# CRON_CONTAINER is not optional. Background jobs run in the cron container, not
# in cloud_app, and TelemetrySampleJob is the only writer of mission history. It
# was missing here, so cron could not resolve nc_roomba_bridge at all --
# "Could not resolve host: nc_roomba_bridge" every five minutes, silently, while
# the app itself worked fine because cloud_app *was* attached. Mission history
# therefore never recorded anything. The same omission broke nc-litter.
#
# `docker network connect` does not survive a container recreate, so re-run
# `make bridge-up` after recreating the cloud stack (or move these attachments
# into the cloud compose file, which is the durable home for them).
CRON_CONTAINER ?= cloud_cron

bridge-up:
	$(BRIDGE_COMPOSE) up -d --build
	@for c in $(CONTAINER) $(CRON_CONTAINER); do \
		if docker network connect $(BRIDGE_NET) $$c 2>/dev/null; then \
			echo "attached $$c to $(BRIDGE_NET)"; \
		else \
			echo "$$c already on $(BRIDGE_NET) (or not running)"; \
		fi; \
	done
	@$(MAKE) --no-print-directory bridge-net-check
	@echo "nc_roomba_bridge up on $(BRIDGE_NET) (ROOMBA_MOCK from .env / compose default)"

# Fails loudly if the cron container cannot reach the bridge -- the exact
# condition that silently disabled mission history for the life of the project.
bridge-net-check:
	@ok=1; \
	for c in $(CONTAINER) $(CRON_CONTAINER); do \
		if ! docker ps --format '{{.Names}}' | grep -qx "$$c"; then \
			echo "  skip $$c (not running)"; continue; \
		fi; \
		code=$$(docker exec $$c sh -c 'curl -s -m 5 -o /dev/null -w "%{http_code}" http://nc_roomba_bridge:8080/health' 2>/dev/null); \
		if [ "$$code" = "200" ]; then \
			echo "  OK   $$c can reach the bridge"; \
		else \
			echo "  FAIL $$c cannot reach nc_roomba_bridge (HTTP $$code)"; ok=0; \
		fi; \
	done; \
	test $$ok -eq 1 || (echo "bridge unreachable from a required container -- mission history will not record" && exit 1)

bridge-down:
	$(BRIDGE_COMPOSE) down

bridge-test:
	cd "$(ROOT)bridge" && npm test

helper-test:
	cd "$(ROOT)wifi-helper" && npm test

# Install host Soft-AP helper (needs sudo). Generates token into /etc if missing.
helper-install:
	@if [ -f "$(ROOT)wifi-helper/package-lock.json" ]; then \
		cd "$(ROOT)wifi-helper" && npm ci --omit=dev; \
	else \
		cd "$(ROOT)wifi-helper" && npm install --omit=dev; \
	fi
	@token=$$(grep -E '^ROOMBA_WIFI_HELPER_TOKEN=' "$(ROOT).env" 2>/dev/null | cut -d= -f2-); \
	if [ -z "$$token" ]; then token=$$(openssl rand -hex 16); \
		grep -q '^ROOMBA_WIFI_HELPER_TOKEN=' "$(ROOT).env" 2>/dev/null \
			&& sed -i "s/^ROOMBA_WIFI_HELPER_TOKEN=.*/ROOMBA_WIFI_HELPER_TOKEN=$$token/" "$(ROOT).env" \
			|| echo "ROOMBA_WIFI_HELPER_TOKEN=$$token" >> "$(ROOT).env"; \
		echo "Wrote ROOMBA_WIFI_HELPER_TOKEN to .env"; \
	fi; \
	echo "ROOMBA_WIFI_HELPER_TOKEN=$$token" | sudo tee /etc/nc-roomba-wifi-helper.env >/dev/null; \
	iface="$${ROOMBA_WIFI_IFACE:-}"; \
	if [ -z "$$iface" ]; then \
		echo "Set ROOMBA_WIFI_IFACE to your host Wi-Fi interface (e.g. wlan0) before helper-install"; \
		exit 1; \
	fi; \
	echo "ROOMBA_WIFI_IFACE=$$iface" | sudo tee -a /etc/nc-roomba-wifi-helper.env >/dev/null; \
	echo "ROOMBA_WIFI_HELPER_DIR=$${ROOMBA_WIFI_HELPER_DIR:-$(ROOT)wifi-helper}" | sudo tee -a /etc/nc-roomba-wifi-helper.env >/dev/null; \
	sudo cp "$(ROOT)wifi-helper/systemd/nc-roomba-wifi-helper.service" /etc/systemd/system/; \
	sudo systemctl daemon-reload; \
	sudo systemctl enable --now nc-roomba-wifi-helper; \
	sudo systemctl status nc-roomba-wifi-helper --no-pager || true

helper-up:
	sudo systemctl start nc-roomba-wifi-helper

helper-down:
	sudo systemctl stop nc-roomba-wifi-helper

run-phpunit:
	@if [ -f "$(ROOT)vendor/bin/phpunit" ] && command -v php >/dev/null 2>&1; then \
		cd "$(ROOT)" && vendor/bin/phpunit; \
	elif [ -f "$(ROOT)vendor/bin/phpunit" ]; then \
		docker run --rm -v "$(ROOT):/app" -w /app php:8.2-cli php vendor/bin/phpunit; \
	else \
		docker run --rm -v "$(ROOT):/app" -w /app composer:2 composer install --no-interaction; \
		docker run --rm -v "$(ROOT):/app" -w /app php:8.2-cli php vendor/bin/phpunit; \
	fi

phpunit: run-phpunit

test: phpunit bridge-test helper-test
	cd "$(ROOT)" && npm run test

deploy: build
	@test -n "$$(docker ps -q -f name=$(CONTAINER))" || (echo "Container $(CONTAINER) not running" && exit 1)
	@$(MAKE) bridge-up || echo "warning: bridge-up failed — continuing deploy"
	docker exec $(CONTAINER) mkdir -p $(REMOTE)
	for dir in appinfo css img js lib templates tools knowledge; do \
		if [ -d "$(ROOT)$$dir" ]; then \
			docker exec $(CONTAINER) rm -rf $(REMOTE)/$$dir; \
			docker cp "$(ROOT)$$dir/." $(CONTAINER):$(REMOTE)/$$dir/; \
		fi; \
	done
	@docker exec $(CONTAINER) chown -R www-data:www-data $(REMOTE) 2>/dev/null || true
	@if [ -f "$(ROOT)composer.json" ]; then docker cp "$(ROOT)composer.json" $(CONTAINER):$(REMOTE)/; fi
	docker exec -u www-data $(CONTAINER) php /var/www/html/occ app:enable $(APP_ID) || true
	docker exec -u www-data $(CONTAINER) php /var/www/html/occ upgrade
	@docker exec -u www-data $(CONTAINER) php -r 'function_exists("opcache_reset") && @opcache_reset();' 2>/dev/null || true
	@if [ "$(RESTART)" = "1" ]; then \
		echo "RESTART=1 -> restarting $(CONTAINER)"; \
		docker restart $(CONTAINER) >/dev/null && sleep 8; \
		docker network connect $(BRIDGE_NET) $(CONTAINER) 2>/dev/null || true; \
	fi
	@echo "Deployed $(APP_ID) to $(CONTAINER):$(REMOTE)"

# gate-gui is in the chain now that it is green and guards real regressions
# (the dt reset, the contrast tokens, the sticky action error, and a check that
# the global stylesheet injection never comes back). It had rotted to a failing
# state precisely because nothing ran it.
ship: build bridge-up deploy gate-preflight gate-gui
	@echo "ship complete"

gate-preflight:
	bash "$(ROOT)tools/roomba-preflight.sh"
	$(MAKE) run-phpunit
	$(MAKE) bridge-test
	cd "$(ROOT)" && npm run test
	cd "$(ROOT)" && npm run build
	@test -n "$$(docker ps -q -f name=$(CONTAINER))" || (echo "Container not running — skip API gates" && exit 0)
	docker exec $(CONTAINER) php $(REMOTE)/tools/roomba-api-gates.php

# The script reads mocked-ness from the bridge itself rather than from the
# environment, because it commands the robot: setting ROOMBA_MOCK=1 here used to
# imply safety while the script ignored it entirely, so `make gate-live` against
# the real 960 would start a cleaning mission and rewrite the weekly schedule.
# Pass ROOMBA_ALLOW_LIVE_ROBOT=1 to opt into the destructive gates on purpose.
gate-live:
	bash "$(ROOT)tools/roomba-live-gates.sh"

gate-gui:
	bash "$(ROOT)tools/roomba-gui-gates.sh"

VERSION := $(shell grep -oE '<version>[0-9]+\.[0-9]+\.[0-9]+</version>' "$(ROOT)appinfo/info.xml" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
STAGING := /tmp/$(APP_ID)-$(VERSION)
TARBALL := /tmp/$(APP_ID)-$(VERSION).tar.gz

# Self-contained App Store tarball (built js/css + composer vendor; no bridge/wifi-helper).
# Built assets under js/ are included even when gitignored — `appstore` depends on `build`.
appstore: build
	rm -rf "$(STAGING)"
	mkdir -p "$(STAGING)"
	rsync -a --delete \
		--exclude node_modules --exclude tests --exclude .git --exclude .github \
		--exclude bridge --exclude wifi-helper --exclude src \
		--exclude docs/plans --exclude .cursor --exclude .phpunit.cache \
		--exclude .phpunit.result.cache --exclude .vitest-gate-stamp \
		--exclude '*.map' --exclude coverage --exclude dist \
		--exclude .env --exclude .env.* \
		"$(ROOT)" "$(STAGING)/"
	# Keep .env.example if present (rsync --exclude .env.* would drop it).
	@if [ -f "$(ROOT).env.example" ]; then cp "$(ROOT).env.example" "$(STAGING)/.env.example"; fi
	@if command -v composer >/dev/null 2>&1; then \
		cd "$(STAGING)" && composer install --no-dev --no-interaction --optimize-autoloader; \
	else \
		echo "composer not on PATH — running in the composer:2 container"; \
		docker run --rm -v "$(STAGING):/app" -w /app composer:2 \
			composer install --no-dev --no-interaction --optimize-autoloader; \
	fi
	rm -rf "$(STAGING)/node_modules"
	tar -czf "$(TARBALL)" -C /tmp "$(APP_ID)-$(VERSION)"
	@echo "Release tarball: $(TARBALL)"

appstore-sign: appstore
	@test -n "$(NC_OCC)" || (echo "Set NC_OCC to your occ binary path" && exit 1)
	@test -n "$$APP_PRIVATE_KEY" || (echo "Set APP_PRIVATE_KEY to private key file path" && exit 1)
	@test -n "$$APP_PUBLIC_CRT" || (echo "Set APP_PUBLIC_CRT to certificate file path" && exit 1)
	cp "$(ROOT)scripts/file_from_env.php" "$(STAGING)/file_from_env.php"
	php "$(NC_OCC)" integrity:sign-app \
		--privateKey="file://$(STAGING)/file_from_env.php" \
		--certificate="file://$(STAGING)/file_from_env.php" \
		$(APP_ID)
	APP_PRIVATE_KEY="$$APP_PRIVATE_KEY" APP_PUBLIC_CRT="$$APP_PUBLIC_CRT" \
	php "$(NC_OCC)" integrity:check-app $(APP_ID)
	tar -czf "$(TARBALL)" -C /tmp "$(APP_ID)-$(VERSION)"
	@echo "Signed tarball: $(TARBALL)"
