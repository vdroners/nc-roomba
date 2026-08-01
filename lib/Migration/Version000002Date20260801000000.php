<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Mission provenance + retention indexes.
 *
 * Adds:
 *  - `bridge_seq` / `source` on missions, so a mission recorded from the
 *    bridge's own journal can be de-duplicated across repeated drains and so
 *    the UI can say honestly where a row came from (the bridge saw both edges,
 *    or Nextcloud inferred it from the robot's odometer without witnessing it).
 *  - `nMssn` bookends, letting the odometer-delta safety net reconcile what it
 *    recorded against what the robot counted.
 *  - single-column `ts` indexes on telemetry and audit. The original migration
 *    only created composite `(robot_id, ts)` indexes, which cannot serve the
 *    ts-only predicate retention uses, so pruning full-scanned both tables.
 */
class Version000002Date20260801000000 extends SimpleMigrationStep
{
	/**
	 * @param Closure(): ISchemaWrapper $schemaClosure
	 * @param array<string, mixed> $options
	 */
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('nc_roomba_missions')) {
			$table = $schema->getTable('nc_roomba_missions');

			if (!$table->hasColumn('bridge_seq')) {
				$table->addColumn('bridge_seq', Types::BIGINT, [
					'notnull' => false,
					'default' => null,
				]);
			}
			if (!$table->hasColumn('source')) {
				// 'bridge'   — both edges observed over MQTT (authoritative timings)
				// 'telemetry'— reconstructed from Nextcloud's periodic sampling
				// 'odometer' — inferred from an nMssn delta; boundaries not observed
				$table->addColumn('source', Types::STRING, [
					'notnull' => false,
					'length' => 16,
					'default' => null,
				]);
			}
			if (!$table->hasColumn('n_mssn_start')) {
				$table->addColumn('n_mssn_start', Types::INTEGER, [
					'notnull' => false,
					'default' => null,
				]);
			}
			if (!$table->hasColumn('n_mssn_end')) {
				$table->addColumn('n_mssn_end', Types::INTEGER, [
					'notnull' => false,
					'default' => null,
				]);
			}
			if (!$table->hasIndex('nc_roomba_msn_seq_idx')) {
				$table->addIndex(['robot_id', 'bridge_seq'], 'nc_roomba_msn_seq_idx');
			}
			if (!$table->hasIndex('nc_roomba_msn_ended_idx')) {
				$table->addIndex(['ended_at'], 'nc_roomba_msn_ended_idx');
			}
		}

		// Retention filters on `ts` alone; a leading-robot_id composite index
		// cannot serve that, so these were full table scans.
		if ($schema->hasTable('nc_roomba_telemetry_samples')) {
			$table = $schema->getTable('nc_roomba_telemetry_samples');
			if (!$table->hasIndex('nc_roomba_tel_ts_idx')) {
				$table->addIndex(['ts'], 'nc_roomba_tel_ts_idx');
			}
		}
		if ($schema->hasTable('nc_roomba_command_audit')) {
			$table = $schema->getTable('nc_roomba_command_audit');
			if (!$table->hasIndex('nc_roomba_audit_ts_idx')) {
				$table->addIndex(['ts'], 'nc_roomba_audit_ts_idx');
			}
		}

		return $schema;
	}
}
