APP_ID ?= nc_roomba
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
CONTAINER ?= cloud_app
REMOTE := /var/www/html/custom_apps/$(APP_ID)
BRIDGE_COMPOSE := docker compose -f "$(ROOT)docker-compose.bridge.yml"
BRIDGE_NET := nc-roomba-net
DATE ?= $(shell date +%F)

.PHONY: build test deploy ship bridge-up bridge-down bridge-test \
	bump-patch bump-minor gate-preflight gate-live gate-gui \
	phpunit run-phpunit helper-install helper-test helper-up helper-down

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
bridge-up:
	$(BRIDGE_COMPOSE) up -d --build
	@docker network connect $(BRIDGE_NET) $(CONTAINER) 2>/dev/null \
		|| echo "cloud_app already on $(BRIDGE_NET) (or not running)"
	@echo "nc_roomba_bridge up on $(BRIDGE_NET) (ROOMBA_MOCK from .env / compose default)"

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
	echo "ROOMBA_WIFI_IFACE=wlp2s0" | sudo tee -a /etc/nc-roomba-wifi-helper.env >/dev/null; \
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

ship: build bridge-up deploy gate-preflight
	@echo "ship complete"

gate-preflight:
	bash "$(ROOT)tools/roomba-preflight.sh"
	$(MAKE) run-phpunit
	$(MAKE) bridge-test
	cd "$(ROOT)" && npm run test
	cd "$(ROOT)" && npm run build
	@test -n "$$(docker ps -q -f name=$(CONTAINER))" || (echo "Container not running — skip API gates" && exit 0)
	docker exec $(CONTAINER) php $(REMOTE)/tools/roomba-api-gates.php

gate-live:
	ROOMBA_MOCK=$${ROOMBA_MOCK:-1} bash "$(ROOT)tools/roomba-live-gates.sh"

gate-gui:
	bash "$(ROOT)tools/roomba-gui-gates.sh"
