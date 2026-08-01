<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<TelemetrySample> */
class TelemetrySampleMapper extends QBMapper
{
	public function __construct(IDBConnection $db)
	{
		parent::__construct($db, 'nc_roomba_telemetry_samples', TelemetrySample::class);
	}

	/** @return TelemetrySample[] */
	public function findByMission(int $missionId, int $limit = 5000): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('mission_id', $qb->createNamedParameter($missionId, IQueryBuilder::PARAM_INT)))
			->orderBy('ts', 'ASC')
			->setMaxResults(max(1, $limit));
		return $this->findEntities($qb);
	}

	/**
	 * Delete samples older than the cutoff, sparing any that belong to a mission
	 * retention is keeping.
	 *
	 * Without the exclusion a long mission that started before the cutoff kept
	 * its row but lost every sample under it, so its detail view rendered empty.
	 *
	 * @param int[] $keepMissionIds missions that must retain their samples
	 */
	public function deleteOlderThan(int $cutoffTs, array $keepMissionIds = []): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->lt('ts', $qb->createNamedParameter($cutoffTs, IQueryBuilder::PARAM_INT)));
		$this->excludeRetained($qb, $keepMissionIds);
		return $qb->executeStatement();
	}

	/** @param int[] $missionIds */
	public function deleteByMissionIds(array $missionIds): int
	{
		if ($missionIds === []) {
			return 0;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->in('mission_id', $qb->createNamedParameter($missionIds, IQueryBuilder::PARAM_INT_ARRAY)));
		return $qb->executeStatement();
	}

	/**
	 * Rows with an all-null reading: the residue of an ingest bug that fed the
	 * bridge's response envelope to the sampler instead of the state DTO, so
	 * every field resolved to null while the row itself was still written.
	 *
	 * Matched on the null signature so this can only ever hit that residue.
	 */
	public function deleteEmptySamples(int $robotId = 0): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->isNull('phase'))
			->andWhere($qb->expr()->isNull('battery_pct'))
			->andWhere($qb->expr()->isNull('bin_status'))
			->andWhere($qb->expr()->isNull('rssi'))
			->andWhere($qb->expr()->isNull('pose_x'));
		if ($robotId > 0) {
			$qb->andWhere($qb->expr()->eq('robot_id', $qb->createNamedParameter($robotId, IQueryBuilder::PARAM_INT)));
		}
		return $qb->executeStatement();
	}

	/**
	 * @param \OCP\DB\QueryBuilder\IQueryBuilder $qb
	 * @param int[] $keepMissionIds
	 */
	private function excludeRetained($qb, array $keepMissionIds): void
	{
		if ($keepMissionIds === []) {
			return;
		}
		$qb->andWhere($qb->expr()->orX(
			$qb->expr()->isNull('mission_id'),
			$qb->expr()->notIn('mission_id', $qb->createNamedParameter($keepMissionIds, IQueryBuilder::PARAM_INT_ARRAY)),
		));
	}

	/** @param int[] $keepMissionIds */
	public function countOlderThan(int $cutoffTs, array $keepMissionIds = []): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'cnt'))
			->from($this->getTableName())
			->where($qb->expr()->lt('ts', $qb->createNamedParameter($cutoffTs, IQueryBuilder::PARAM_INT)));
		$this->excludeRetained($qb, $keepMissionIds);
		$row = $qb->executeQuery()->fetch();
		return (int) ($row['cnt'] ?? 0);
	}
}
