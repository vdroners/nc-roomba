<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Migration;

use OCA\NcRoomba\AppInfo\Application;
use OCA\NcRoomba\Db\TelemetrySampleMapper;
use OCA\NcRoomba\Service\BridgeClient;
use OCP\IConfig;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

/**
 * One-off cleanup for the ingest bug that produced empty telemetry.
 *
 * `TelemetrySampleJob` handed `MissionService::ingestState()` the bridge's
 * response *envelope* instead of the state DTO, so every field lookup missed:
 * `phase`, `battery_pct`, `bin_status`, `rssi` and the pose columns were all
 * written as NULL while the row itself was still inserted. On this install that
 * left 521 rows of nothing, accumulated since the app was first deployed, and
 * not one mission was ever recorded.
 *
 * Two jobs here:
 *
 *  1. Delete the empty rows. They carry no information and would otherwise
 *     distort any average or trend computed over the telemetry table, and sit
 *     there for the full 365-day retention.
 *  2. Seed the lifetime-mission baseline. The robot has run ~1,800 missions that
 *     predate the app; their per-mission detail is unrecoverable (the bridge
 *     kept history only in memory and the robot itself stores just aggregates).
 *     Recording where the counter stood at first run means Lifetime stats and
 *     the streak achievements score from a known point instead of pretending
 *     the app witnessed a robot's entire life.
 */
class PurgeEmptyTelemetryRepairStep implements IRepairStep
{
	public function __construct(
		private TelemetrySampleMapper $telemetry,
		private BridgeClient $bridge,
		private IConfig $config,
	) {
	}

	public function getName(): string
	{
		return 'NC Roomba: purge empty telemetry rows and seed the mission baseline';
	}

	public function run(IOutput $output): void
	{
		$this->purgeEmptySamples($output);
		$this->seedBaseline($output);
	}

	private function purgeEmptySamples(IOutput $output): void
	{
		// Matched on the all-null signature, so this can only ever hit rows the
		// bug produced -- a genuine sample always carries at least a phase.
		$deleted = $this->telemetry->deleteEmptySamples();
		if ($deleted > 0) {
			$output->info(sprintf(
				'Removed %d telemetry rows with no readings (residue of the ingest envelope bug).',
				$deleted,
			));
		} else {
			$output->info('No empty telemetry rows found.');
		}
	}

	private function seedBaseline(IOutput $output): void
	{
		$key = 'mission_baseline_json';
		if ($this->config->getAppValue(Application::APP_ID, $key, '') !== '') {
			$output->info('Lifetime baseline already recorded; leaving it alone.');
			return;
		}

		$resp = $this->bridge->getState(1);
		$state = is_array($resp['body'] ?? null) ? $resp['body'] : [];
		if ($state === []) {
			// Not fatal: the sampler seeds this too, on its first successful run.
			$output->info('Bridge unreachable; the lifetime baseline will be seeded on the next telemetry sample.');
			return;
		}

		$baseline = [
			'recorded_at' => time(),
			'bbmssn' => is_array($state['bbmssn'] ?? null) ? $state['bbmssn'] : null,
			'bbrun' => is_array($state['bbrun'] ?? null) ? $state['bbrun'] : null,
		];
		$this->config->setAppValue(Application::APP_ID, $key, json_encode($baseline, JSON_THROW_ON_ERROR));

		$missions = $baseline['bbmssn']['nMssn'] ?? null;
		$output->info(sprintf(
			'Recorded the lifetime baseline (%s missions before this install); progress is scored from here.',
			$missions === null ? 'unknown' : (string) $missions,
		));
	}
}
