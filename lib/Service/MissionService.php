<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Service;

use OCA\NcRoomba\Db\Mission;
use OCA\NcRoomba\Db\MissionMapper;
use OCA\NcRoomba\Db\MissionPhaseEvent;
use OCA\NcRoomba\Db\MissionPhaseEventMapper;
use OCA\NcRoomba\Db\TelemetrySample;
use OCA\NcRoomba\Db\TelemetrySampleMapper;
use OCA\NcRoomba\Db\CommandAuditMapper;
use OCA\NcRoomba\AppInfo\Application;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

class MissionService
{
	/**
	 * Cycles that mean the robot is actually cleaning.
	 *
	 * The robot also reports non-cleaning errands as a `cycle`: `dock` (driving
	 * home), `evac` (emptying into a base), `train` (a mapping run). An earlier
	 * revision treated "anything but none" as a mission -- widened to catch
	 * `quick`, which this robot really does report -- and consequently filed a
	 * five-second docking manoeuvre in History as a completed clean.
	 */
	private const CLEANING_CYCLES = ['clean', 'quick', 'spot'];

	/** Two missions this close together are the same physical run, seen twice. */
	private const OVERLAP_TOLERANCE_S = 900;

	/** appconfig key prefix: last bridge journal seq drained, per robot. */
	private const CURSOR_PREFIX = 'mission_cursor_';
	/** appconfig key prefix: last observed lifetime mission counter, per robot. */
	private const ODOMETER_PREFIX = 'mission_odometer_';

	public function __construct(
		private MissionMapper $missions,
		private MissionPhaseEventMapper $phases,
		private TelemetrySampleMapper $telemetry,
		private CommandAuditMapper $audit,
		private ErrorDecoderService $errors,
		private NotifyService $notify,
		private RobotService $robots,
		private BridgeClient $bridge,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @return array{items:list<array<string,mixed>>,total:int}
	 */
	public function listMissions(int $robotId = 0, int $limit = 50, int $offset = 0): array
	{
		if ($robotId <= 0) {
			$primary = $this->robots->getPrimaryRobot();
			$robotId = $primary !== null ? (int) $primary->getId() : 0;
		}
		if ($robotId <= 0) {
			return ['items' => [], 'total' => 0];
		}
		$rows = $this->missions->findByRobot($robotId, $limit, $offset);
		return [
			'items' => array_map(static fn (Mission $m) => $m->jsonSerialize(), $rows),
			// The real row count, not the size of the page just fetched.
			'total' => $this->missions->countByRobot($robotId),
			'robot_id' => $robotId,
		];
	}

	/** @return array<string, mixed>|null */
	public function detail(int $missionId): ?array
	{
		try {
			$mission = $this->missions->find($missionId);
		} catch (DoesNotExistException) {
			return null;
		}
		$phaseRows = $this->phases->findByMission($missionId);
		$telem = $this->telemetry->findByMission($missionId, 2000);
		$data = $mission->jsonSerialize();
		$data['phase_events'] = array_map(static fn (MissionPhaseEvent $e) => $e->jsonSerialize(), $phaseRows);
		$data['telemetry'] = array_map(static fn (TelemetrySample $s) => $s->jsonSerialize(), $telem);
		$data['decoded_error'] = $this->errors->decode((int) $mission->getErrorCode(), 0);
		return $data;
	}

	/**
	 * Persist a telemetry sample and roll mission / phase / notifications.
	 *
	 * @param array<string, mixed> $state
	 */
	public function ingestState(int $robotId, array $state): void
	{
		$now = time();
		$phase = (string) ($state['phase'] ?? '');
		$cycle = (string) ($state['cycle'] ?? 'none');
		$battery = isset($state['battery_pct']) ? (int) $state['battery_pct'] : null;
		$bin = isset($state['bin']) ? (string) $state['bin'] : null;
		$error = (int) ($state['error'] ?? 0);
		$notReady = (int) ($state['not_ready'] ?? $state['notReady'] ?? 0);
		$pose = is_array($state['pose'] ?? null) ? $state['pose'] : [];

		$open = $this->missions->findOpenMission($robotId);
		// Any cycle other than 'none' means the robot is on a job. The old list
		// was ['clean','spot'] and missed the value this 960 actually reports
		// while running -- 'quick' -- which only escaped notice because the phase
		// check usually caught it too. It did not during hmUsrDock.
		$running = in_array($cycle, self::CLEANING_CYCLES, true)
			|| in_array($phase, ['run', 'hmMidMsn', 'hmPostMsn'], true);

		if ($running && $open === null) {
			$open = new Mission();
			$open->setRobotId($robotId);
			$open->setStartedAt($now);
			$open->setEndedAt(null);
			$open->setCycle($cycle !== '' ? $cycle : 'clean');
			$open->setResult('open');
			$open->setErrorCode(0);
			$open->setBatteryStart($battery);
			$open->setCreatedAt($now);
			$open->setSource('telemetry');
			$open->setNMssnStart(self::intOrNull(($state['bbmssn'] ?? [])['nMssn'] ?? null));
			$open = $this->missions->insert($open);
			$this->appendPhase($open, $phase !== '' ? $phase : 'run', $cycle, 'telemetry');
		}

		$sample = new TelemetrySample();
		$sample->setRobotId($robotId);
		$sample->setMissionId($open !== null ? (int) $open->getId() : null);
		$sample->setTs($now);
		$sample->setBatteryPct($battery);
		$sample->setBinStatus($bin);
		$sample->setPhase($phase !== '' ? $phase : null);
		$sample->setCycle($cycle !== '' ? $cycle : null);
		$sample->setRssi(isset($state['rssi']) ? (int) $state['rssi'] : null);
		$sample->setErrorCode($error);
		$sample->setNotReady($notReady);
		$sample->setPoseX(isset($pose['x']) && is_numeric($pose['x']) ? (float) $pose['x'] : null);
		$sample->setPoseY(isset($pose['y']) && is_numeric($pose['y']) ? (float) $pose['y'] : null);
		$sample->setPoseTheta(isset($pose['theta']) && is_numeric($pose['theta']) ? (float) $pose['theta'] : null);
		$sample->setPayloadJson(json_encode([
			'mission' => $state['mission'] ?? null,
			'bbrun' => $state['bbrun'] ?? null,
		], JSON_THROW_ON_ERROR));
		$this->telemetry->insert($sample);

		if ($open !== null) {
			// Only the latest event matters here; this used to load every phase
			// row of the mission on every single sample.
			$last = $this->phases->findLatestForMission((int) $open->getId());
			if ($phase !== '' && ($last === null || $last->getPhase() !== $phase || (string) $last->getCycle() !== $cycle)) {
				$this->appendPhase($open, $phase, $cycle, 'telemetry');
			}

			$missionMeta = is_array($state['mission'] ?? null) ? $state['mission'] : [];
			// This 960 reports sqft and mssnM as 0 for the whole mission, which is
			// exactly why the bridge derives estimates from the swept-cell
			// footprint and the elapsed clock. Prefer what the robot measured;
			// fall back to the estimate rather than recording a confident 0 and
			// notifying the operator that it "finished cleaning (0 sq ft)".
			$sqft = self::firstPositive($missionMeta['sqft'] ?? null, $missionMeta['sqft_est'] ?? null);
			if ($sqft !== null) {
				$open->setSqft($sqft);
			}
			$mins = self::firstPositive($missionMeta['mssn_m'] ?? null, $missionMeta['mission_m_est'] ?? null);
			if ($mins !== null) {
				$open->setMsnM($mins);
			}

			$ended = in_array($phase, ['charge', 'stop'], true) && in_array($cycle, ['none', ''], true);
			if ($ended) {
				$open->setNMssnEnd(self::intOrNull(($state['bbmssn'] ?? [])['nMssn'] ?? null));
				$open->setEndedAt($now);
				$open->setPhaseFinal($phase);
				$open->setBatteryEnd($battery);
				$open->setErrorCode($error);
				$open->setResult($error !== 0 ? 'error' : 'complete');
				$map = self::mapSnapshotFromState($state);
				if ($map !== null) {
					$open->setMapJson(json_encode($map, JSON_THROW_ON_ERROR));
				}
				$this->missions->update($open);

				$robot = $this->robots->getRobot($robotId);
				$name = $robot?->getName() ?? Application::DEFAULT_ROBOT_NAME;
				if ($error !== 0) {
					$decoded = $this->errors->decode($error, 0);
					$this->notify->missionError($name, $decoded['title'], $error);
				} else {
					$this->notify->missionComplete($name, (int) $open->getId(), $open->getSqft());
				}
			} else {
				$this->missions->update($open);
			}
		}

		$robot = $this->robots->getRobot($robotId);
		$name = $robot?->getName() ?? Application::DEFAULT_ROBOT_NAME;
		static $binNotified = [];
		static $battNotified = [];
		$key = (string) $robotId;
		if ($bin === 'full' && empty($binNotified[$key])) {
			$this->notify->binFull($name);
			$binNotified[$key] = true;
		}
		if ($battery !== null && $battery <= 15 && empty($battNotified[$key])) {
			$this->notify->lowBattery($name, $battery);
			$battNotified[$key] = true;
		}
	}

	/**
	 * Pull completed missions from the bridge's journal and record any we have
	 * not already stored.
	 *
	 * This is the accurate path. The bridge watches MQTT continuously, so it
	 * knows exactly when a mission began and ended; Nextcloud's own sampler runs
	 * on five-minute cron with measured gaps up to 110 minutes against a
	 * 28-minute average mission, and would otherwise miss short runs entirely
	 * and mis-date the rest.
	 *
	 * Idempotent: each journal entry carries a monotonic `seq`, stored on the
	 * mission row, so a redelivery or a crash between fetch and cursor-write
	 * cannot duplicate a mission.
	 *
	 * @return array{fetched:int,recorded:int,cursor:int}
	 */
	public function drainBridgeMissions(int $robotId): array
	{
		$cursor = (int) $this->config->getAppValue(
			Application::APP_ID,
			self::CURSOR_PREFIX . $robotId,
			'0',
		);
		$resp = $this->bridge->getMissions($cursor);
		$body = is_array($resp['body'] ?? null) ? $resp['body'] : [];
		$records = is_array($body['missions'] ?? null) ? $body['missions'] : [];

		// A journal that has been reset (fresh volume, or the file was lost)
		// restarts its sequence. Detect it and re-sync rather than silently
		// ignoring every future mission because our cursor is ahead.
		$nextSeq = (int) ($body['next_seq'] ?? 0);
		if ($nextSeq > 0 && $nextSeq <= $cursor) {
			$this->logger->warning(
				'nc_roomba: bridge mission journal restarted (next_seq {next} <= cursor {cursor}); re-syncing',
				['next' => $nextSeq, 'cursor' => $cursor],
			);
			$cursor = 0;
			$resp = $this->bridge->getMissions(0);
			$body = is_array($resp['body'] ?? null) ? $resp['body'] : [];
			$records = is_array($body['missions'] ?? null) ? $body['missions'] : [];
		}

		$recorded = 0;
		foreach ($records as $record) {
			if (!is_array($record)) {
				continue;
			}
			$seq = self::intOrNull($record['seq'] ?? null);
			if ($seq === null) {
				continue;
			}
			$cursor = max($cursor, $seq);
			if ($this->missions->findByBridgeSeq($robotId, $seq) !== null) {
				continue; // already stored
			}
			$this->recordBridgeMission($robotId, $seq, $record);
			$recorded++;
		}

		$this->config->setAppValue(Application::APP_ID, self::CURSOR_PREFIX . $robotId, (string) $cursor);
		return ['fetched' => count($records), 'recorded' => $recorded, 'cursor' => $cursor];
	}

	/**
	 * @param array<string, mixed> $record a bridge journal entry
	 */
	private function recordBridgeMission(int $robotId, int $seq, array $record): void
	{
		$started = self::tsOrNull($record['started_at'] ?? null) ?? time();
		$ended = self::tsOrNull($record['ended_at'] ?? null);
		$error = (int) ($record['error_code'] ?? 0);

		$mission = new Mission();
		$mission->setRobotId($robotId);
		$mission->setStartedAt($started);
		$mission->setEndedAt($ended);
		$mission->setCycle((string) ($record['cycle'] ?? 'clean'));
		$mission->setPhaseFinal(isset($record['phase_final']) ? (string) $record['phase_final'] : null);
		$mission->setErrorCode($error);
		$mission->setResult($error !== 0 ? 'error' : 'complete');
		$mission->setSqft(self::firstPositive($record['sqft'] ?? null, $record['sqft_est'] ?? null));
		$mission->setMsnM(self::firstPositive($record['mssn_m'] ?? null, $record['mission_m_est'] ?? null));
		$mission->setBatteryStart(self::intOrNull($record['battery_start'] ?? null));
		$mission->setBatteryEnd(self::intOrNull($record['battery_end'] ?? null));
		$mission->setNMssnStart(self::intOrNull($record['n_mssn_start'] ?? null));
		$mission->setNMssnEnd(self::intOrNull($record['n_mssn_end'] ?? null));
		$mission->setBridgeSeq($seq);
		$mission->setSource('bridge');
		$mission->setCreatedAt(time());
		$map = self::mapSnapshotFromRecord($record);
		if ($map !== null) {
			$mission->setMapJson(json_encode($map, JSON_THROW_ON_ERROR));
		}
		$mission = $this->missions->insert($mission);

		// One physical run can be caught by all three recorders. The bridge saw
		// the actual MQTT edges, so its record wins: drop any sampled or inferred
		// row covering the same window rather than leaving History showing the
		// mission twice with different times.
		$superseded = $this->supersedeInferred($robotId, $started, $ended ?? $started, (int) $mission->getId());
		if ($superseded > 0) {
			$this->logger->info(
				'nc_roomba: bridge mission seq {seq} superseded {n} inferred row(s) for the same run',
				['seq' => $seq, 'n' => $superseded],
			);
		}

		$robot = $this->robots->getRobot($robotId);
		$name = $robot?->getName() ?? 'the robot';
		if ($error !== 0) {
			$decoded = $this->errors->decode($error, 0);
			$this->notify->missionError($name, $decoded['title'], $error);
		} else {
			$this->notify->missionComplete($name, (int) $mission->getId(), $mission->getSqft());
		}
	}

	/**
	 * Safety net: the robot counts its own missions, so if that counter moved
	 * further than the missions we recorded, a run happened that nobody saw.
	 *
	 * This covers the gaps the other two paths cannot: the bridge restarting
	 * mid-mission, or a mission that began and ended entirely between two cron
	 * samples. The row is marked `source: odometer` and its boundaries are left
	 * null, because we genuinely did not observe them -- far better than
	 * inventing a start time and a duration that never happened.
	 *
	 * @param array<string, mixed> $state
	 * @return int missions recorded
	 */
	public function reconcileOdometer(int $robotId, array $state): int
	{
		$counter = self::intOrNull(($state['bbmssn'] ?? [])['nMssn'] ?? null);
		if ($counter === null) {
			return 0;
		}
		$key = self::ODOMETER_PREFIX . $robotId;
		$seen = $this->config->getAppValue(Application::APP_ID, $key, '');
		if ($seen === '') {
			// First observation: record the baseline, claim nothing retroactively.
			// This robot has 1,803 lifetime missions that predate the app; they are
			// unrecoverable as detail, and inventing rows for them would be a lie.
			$this->config->setAppValue(Application::APP_ID, $key, (string) $counter);
			return 0;
		}

		$previous = (int) $seen;
		$this->config->setAppValue(Application::APP_ID, $key, (string) $counter);
		if ($counter <= $previous) {
			return 0; // counter reset or unchanged
		}

		// How many of the missions in that delta did we already capture?
		//
		// Counter bookends alone are not enough: the bridge journals the moment a
		// cycle stops, and the robot bumps `nMssn` a little later, so a bridge row
		// for this very run typically reads n_mssn_start == n_mssn_end == previous
		// and falls outside (previous, counter]. Trusting the counters alone
		// therefore filed a duplicate for every single mission. Fall back to
		// "is there already a row covering roughly now?" before inventing one.
		$delta = $counter - $previous;
		$accounted = $this->missions->countRecordedBetweenCounters($robotId, $previous, $counter);
		$missing = $delta - $accounted;
		if ($missing <= 0) {
			return 0;
		}
		$now = time();
		if ($this->alreadyRecorded($robotId, $now - self::OVERLAP_TOLERANCE_S, $now)) {
			return 0; // the bridge or the sampler already has this run
		}

		for ($i = 0; $i < min($missing, 10); $i++) {
			$mission = new Mission();
			$mission->setRobotId($robotId);
			// started_at is NOT NULL in the schema, so it has to hold something;
			// `source: odometer` plus a null ended_at is what tells the UI these
			// bounds were never observed.
			$mission->setStartedAt(time());
			$mission->setEndedAt(null);
			$mission->setCycle('clean');
			$mission->setResult('unobserved');
			$mission->setErrorCode(0);
			$mission->setSource('odometer');
			$mission->setNMssnStart($previous);
			$mission->setNMssnEnd($counter);
			$mission->setCreatedAt(time());
			$this->missions->insert($mission);
		}
		$this->logger->info(
			'nc_roomba: odometer moved {prev}->{now} but only {seen} missions were captured; recorded {missing} unobserved',
			['prev' => $previous, 'now' => $counter, 'seen' => $accounted, 'missing' => min($missing, 10)],
		);
		return min($missing, 10);
	}

	/**
	 * Remove sampled/inferred rows that describe the same run as an
	 * authoritative one. Never touches another `bridge` row.
	 */
	private function supersedeInferred(int $robotId, int $start, int $end, int $keepId): int
	{
		$removed = [];
		foreach ($this->missions->findOverlapping($robotId, $start, $end, self::OVERLAP_TOLERANCE_S) as $other) {
			$id = (int) $other->getId();
			if ($id === $keepId || $other->getSource() === 'bridge') {
				continue;
			}
			$removed[] = $id;
		}
		if ($removed === []) {
			return 0;
		}
		$this->phases->deleteByMissionIds($removed);
		$this->telemetry->clearMissionIds($removed);
		return $this->missions->deleteByIds($removed);
	}

	/** True when some mission already covers this window (any source). */
	private function alreadyRecorded(int $robotId, int $start, int $end): bool
	{
		return $this->missions->findOverlapping($robotId, $start, $end, self::OVERLAP_TOLERANCE_S) !== [];
	}

	private static function intOrNull(mixed $value): ?int
	{
		return is_numeric($value) ? (int) $value : null;
	}

	/** Accepts an ISO-8601 string or an epoch int. */
	private static function tsOrNull(mixed $value): ?int
	{
		if (is_numeric($value)) {
			return (int) $value;
		}
		if (is_string($value) && $value !== '') {
			$ts = strtotime($value);
			return $ts !== false ? $ts : null;
		}
		return null;
	}

	private function appendPhase(Mission $mission, string $phase, string $cycle, string $source): void
	{
		$ev = new MissionPhaseEvent();
		$ev->setMissionId((int) $mission->getId());
		$ev->setRobotId((int) $mission->getRobotId());
		$ev->setTs(time());
		$ev->setPhase($phase);
		$ev->setCycle($cycle !== '' ? $cycle : null);
		$ev->setSource($source);
		$this->phases->insert($ev);
	}

	/** Rows are deleted in batches of this size, consistently across tables. */
	private const RETENTION_BATCH = 1000;

	/**
	 * The oldest timestamp retention is allowed to keep.
	 *
	 * A retention of 0 used to produce `time() + 1`, i.e. "delete everything,
	 * including the sample written a second ago" -- and 0 is the natural thing
	 * for an admin to type meaning "keep forever" (the settings field even has
	 * `min="0"`). Treat a non-positive retention as "keep everything" and, as a
	 * backstop, never let the cutoff come within an hour of now so a
	 * misconfigured value cannot erase live data.
	 */
	public static function cutoffFor(int $retentionDays): ?int
	{
		if ($retentionDays <= 0) {
			return null; // keep everything
		}
		return min(time() - ($retentionDays * 86400), time() - 3600);
	}

	/**
	 * @return array{missions:int,telemetry:int,audit:int,cutoff:?int}
	 */
	public function retentionDryRun(int $retentionDays): array
	{
		$cutoff = self::cutoffFor($retentionDays);
		if ($cutoff === null) {
			return [
				'missions' => 0,
				'telemetry' => 0,
				'audit' => 0,
				'cutoff' => null,
				'retention_days' => $retentionDays,
				'note' => 'retention disabled (0 days) — nothing is deleted',
			];
		}
		return [
			'missions' => $this->missions->countEndedBefore($cutoff),
			'telemetry' => $this->telemetry->countOlderThan($cutoff, $this->missions->findIdsRetainedAt($cutoff)),
			'audit' => $this->audit->countOlderThan($cutoff),
			'cutoff' => $cutoff,
			'retention_days' => $retentionDays,
		];
	}

	/**
	 * @return array{missions:int,telemetry:int,audit:int,cutoff:?int}
	 */
	public function retentionApply(int $retentionDays): array
	{
		$cutoff = self::cutoffFor($retentionDays);
		if ($cutoff === null) {
			return [
				'missions' => 0,
				'telemetry' => 0,
				'audit' => 0,
				'cutoff' => null,
				'retention_days' => $retentionDays,
				'note' => 'retention disabled (0 days) — nothing is deleted',
			];
		}

		// Delete in matched batches. Previously the mission scan was capped at
		// 10 000 while the deletes were uncapped, so past that many old missions
		// the phase events for the remainder were orphaned permanently.
		$missionsDeleted = 0;
		while (true) {
			$batch = $this->missions->findEndedBefore($cutoff, self::RETENTION_BATCH);
			if ($batch === []) {
				break;
			}
			$ids = array_map(static fn (Mission $m) => (int) $m->getId(), $batch);
			$this->phases->deleteByMissionIds($ids);
			$this->telemetry->deleteByMissionIds($ids);
			$missionsDeleted += $this->missions->deleteByIds($ids);
		}

		// Telemetry belonging to a mission that retention KEEPS (still open, or
		// ended after the cutoff) must survive even if the sample itself is old
		// -- otherwise a long mission that started before the cutoff loses its
		// samples while the mission row remains, and its detail view renders empty.
		$telemetry = $this->telemetry->deleteOlderThan($cutoff, $this->missions->findIdsRetainedAt($cutoff));
		$audit = $this->audit->deleteOlderThan($cutoff);

		return [
			'missions' => $missionsDeleted,
			'telemetry' => $telemetry,
			'audit' => $audit,
			'cutoff' => $cutoff,
			'retention_days' => $retentionDays,
		];
	}

	/**
	 * @param mixed $primary the robot's own measurement
	 * @param mixed $fallback the bridge's derived estimate
	 */
	private static function firstPositive($primary, $fallback): ?int
	{
		foreach ([$primary, $fallback] as $candidate) {
			if (is_numeric($candidate) && (int) $candidate > 0) {
				return (int) $candidate;
			}
		}
		return null;
	}

	/**
	 * @param array<string, mixed> $state normalized bridge DTO
	 * @return array<string, mixed>|null
	 */
	private static function mapSnapshotFromState(array $state): ?array
	{
		$trail = is_array($state['pose_trail'] ?? null) ? $state['pose_trail'] : [];
		$cells = is_array($state['covered_cells'] ?? null) ? $state['covered_cells'] : [];
		if ($trail === [] && $cells === []) {
			return null;
		}
		return [
			'pose_trail' => $trail,
			'covered_cells' => $cells,
			'cell_cm' => is_numeric($state['cell_cm'] ?? null) ? (int) $state['cell_cm'] : 25,
		];
	}

	/**
	 * @param array<string, mixed> $record bridge journal row
	 * @return array<string, mixed>|null
	 */
	private static function mapSnapshotFromRecord(array $record): ?array
	{
		$trail = is_array($record['pose_trail'] ?? null) ? $record['pose_trail'] : [];
		$cells = is_array($record['covered_cells'] ?? null) ? $record['covered_cells'] : [];
		if ($trail === [] && $cells === []) {
			return null;
		}
		return [
			'pose_trail' => $trail,
			'covered_cells' => $cells,
			'cell_cm' => is_numeric($record['cell_cm'] ?? null) ? (int) $record['cell_cm'] : 25,
		];
	}

	/**
	 * @return array{format:string,content:string,filename:string,content_type:string}
	 */
	public function export(string $format = 'json', int $robotId = 0, int $limit = 500): array
	{
		$list = $this->listMissions($robotId, $limit, 0);
		$items = $list['items'];
		$format = strtolower($format) === 'csv' ? 'csv' : 'json';
		if ($format === 'json') {
			return [
				'format' => 'json',
				'content' => json_encode(['missions' => $items], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT),
				'filename' => 'nc-roomba-missions.json',
				'content_type' => 'application/json; charset=utf-8',
			];
		}
		$fp = fopen('php://temp', 'r+');
		fputcsv($fp, ['id', 'robot_id', 'started_at', 'ended_at', 'cycle', 'sqft', 'mssn_m', 'result', 'error_code', 'battery_start', 'battery_end']);
		foreach ($items as $row) {
			fputcsv($fp, [
				$row['id'],
				$row['robot_id'],
				$row['started_at'],
				$row['ended_at'],
				$row['cycle'],
				$row['sqft'],
				$row['mssn_m'],
				$row['result'],
				$row['error_code'],
				$row['battery_start'],
				$row['battery_end'],
			]);
		}
		rewind($fp);
		$csv = stream_get_contents($fp) ?: '';
		fclose($fp);
		return [
			'format' => 'csv',
			'content' => $csv,
			'filename' => 'nc-roomba-missions.csv',
			'content_type' => 'text/csv; charset=utf-8',
		];
	}
}
