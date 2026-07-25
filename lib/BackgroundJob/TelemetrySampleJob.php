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
					$this->logger->debug('TelemetrySampleJob: bridge state unavailable for robot {id}', ['id' => $id]);
					continue;
				}
				$this->missions->ingestState($id, $resp['body']);
			} catch (\Throwable $e) {
				$this->logger->warning('TelemetrySampleJob failed for robot {id}: {err}', [
					'id' => $id,
					'err' => $e->getMessage(),
				]);
			}
		}
	}
}
