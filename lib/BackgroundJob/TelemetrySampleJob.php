<?php

declare(strict_types=1);

namespace OCA\NcRoomba\BackgroundJob;

use OCA\NcRoomba\Service\BridgeClient;
use OCA\NcRoomba\Service\MissionService;
use OCA\NcRoomba\Service\RobotService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

/**
 * Periodically sample bridge state, append phase events, roll up missions, notify.
 */
class TelemetrySampleJob extends TimedJob
{
	public function __construct(
		ITimeFactory $time,
		private RobotService $robots,
		private BridgeClient $bridge,
		private MissionService $missions,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(30);
	}

	protected function run($argument): void
	{
		foreach ($this->robots->listRobots() as $robot) {
			$id = (int) $robot->getId();
			try {
				$resp = $this->bridge->getState($id);
				if (!$resp['ok'] || !is_array($resp['body'])) {
					// Warning, not debug: this is the sole writer of mission
					// history, so when it cannot reach the bridge the feature is
					// simply off. It logged at debug for the life of the project
					// while cron could not resolve the bridge host, which made a
					// dead pipeline invisible.
					$this->logger->warning(
						'TelemetrySampleJob: bridge state unavailable for robot {id} ({err}) — no mission history will be recorded while this persists',
						['id' => $id, 'err' => $resp['error'] ?? ('HTTP ' . $resp['status'])],
					);
					continue;
				}

				$state = $resp['body'];
				// A shape check with teeth. `is_array()` above cannot catch a
				// wrong-shaped payload because the bridge's envelope is itself an
				// array — which is how the ingest silently wrote 516 all-null
				// telemetry rows and zero missions. `phase` is present on every
				// real DTO, so its absence means the contract moved.
				if (!array_key_exists('phase', $state)) {
					$this->logger->error(
						'TelemetrySampleJob: bridge state for robot {id} has no "phase" — the DTO contract changed (keys: {keys}). Skipping to avoid recording empty samples.',
						['id' => $id, 'keys' => implode(',', array_slice(array_keys($state), 0, 12))],
					);
					continue;
				}

				$this->missions->ingestState($id, $state);

				// The bridge saw the mission edges as they happened; drain what it
				// journalled. Then check the robot's own lifetime counter for runs
				// neither path witnessed (bridge restarted mid-mission, or a whole
				// mission fell between two cron samples).
				$this->missions->drainBridgeMissions($id);
				$this->missions->reconcileOdometer($id, $state);
			} catch (\Throwable $e) {
				$this->logger->warning('TelemetrySampleJob failed for robot {id}: {err}', [
					'id' => $id,
					'err' => $e->getMessage(),
				]);
			}
		}
	}
}
