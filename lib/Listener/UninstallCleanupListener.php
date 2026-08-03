<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Listener;

use OCA\NcRoomba\AppInfo\Application;
use OCP\App\Events\AppUninstallEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IConfig;
use OCP\IDBConnection;

/**
 * Drop nc_roomba_* tables and appconfig on uninstall (App Store cleanup rule).
 *
 * @template-implements IEventListener<AppUninstallEvent>
 */
class UninstallCleanupListener implements IEventListener
{
	private const TABLES = [
		'nc_roomba_mission_phase_events',
		'nc_roomba_telemetry_samples',
		'nc_roomba_command_audit',
		'nc_roomba_floorplans',
		'nc_roomba_missions',
		'nc_roomba_robots',
	];

	public function __construct(
		private IConfig $config,
		private IDBConnection $db,
	) {
	}

	public function handle(Event $event): void
	{
		if (!$event instanceof AppUninstallEvent || $event->getAppId() !== Application::APP_ID) {
			return;
		}

		$prefix = $this->db->getPrefix();
		foreach (self::TABLES as $table) {
			$this->db->executeStatement('DROP TABLE IF EXISTS `' . $prefix . $table . '`');
		}

		$this->config->deleteAppValues(Application::APP_ID);
	}
}
