<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Mission> */
class MissionMapper extends QBMapper
{
	public function __construct(IDBConnection $db)
	{
		parent::__construct($db, 'nc_roomba_missions', Mission::class);
	}

	/** @throws DoesNotExistException */
	public function find(int $id): Mission
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	/** @return Mission[] */
	public function findByRobot(int $robotId, int $limit = 50, int $offset = 0): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('robot_id', $qb->createNamedParameter($robotId, IQueryBuilder::PARAM_INT)))
			->orderBy('started_at', 'DESC')
			->setMaxResults(max(1, min(500, $limit)))
			->setFirstResult(max(0, $offset));
		return $this->findEntities($qb);
	}

	/**
	 * True total for pagination.
	 *
	 * `listMissions()` used to report `count($rows)` — the size of the page it
	 * had just fetched — so `total` could never exceed `limit` and any client
	 * paging on it would believe there was exactly one page.
	 */
	public function countByRobot(int $robotId): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'n'))
			->from($this->getTableName())
			->where($qb->expr()->eq('robot_id', $qb->createNamedParameter($robotId, IQueryBuilder::PARAM_INT)));
		return (int) $qb->executeQuery()->fetchOne();
	}

	/**
	 * Ids of missions that retention is keeping, so their telemetry is not
	 * deleted out from under them.
	 *
	 * @return int[]
	 */
	public function findIdsRetainedAt(int $cutoffTs): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')
			->from($this->getTableName())
			->where($qb->expr()->orX(
				$qb->expr()->isNull('ended_at'),
				$qb->expr()->gte('ended_at', $qb->createNamedParameter($cutoffTs, IQueryBuilder::PARAM_INT)),
			));
		return array_map('intval', $qb->executeQuery()->fetchFirstColumn());
	}

	/**
	 * Has a mission already been recorded from this bridge journal entry?
	 *
	 * The bridge journal is drained repeatedly; without this a redelivery (or a
	 * Nextcloud restart between fetch and cursor write) would duplicate rows.
	 */
	public function findByBridgeSeq(int $robotId, int $seq): ?Mission
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('robot_id', $qb->createNamedParameter($robotId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('bridge_seq', $qb->createNamedParameter($seq, IQueryBuilder::PARAM_INT)))
			->setMaxResults(1);
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @param int[] $ids */
	public function deleteByIds(array $ids): int
	{
		if ($ids === []) {
			return 0;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->in('id', $qb->createNamedParameter($ids, IQueryBuilder::PARAM_INT_ARRAY)));
		return $qb->executeStatement();
	}

	public function findOpenMission(int $robotId): ?Mission
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('robot_id', $qb->createNamedParameter($robotId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->isNull('ended_at'))
			->orderBy('started_at', 'DESC')
			->setMaxResults(1);
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return Mission[] */
	public function findEndedBefore(int $cutoffTs, int $limit = 500): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->isNotNull('ended_at'))
			->andWhere($qb->expr()->lt('ended_at', $qb->createNamedParameter($cutoffTs, IQueryBuilder::PARAM_INT)))
			->orderBy('ended_at', 'ASC')
			->setMaxResults(max(1, $limit));
		return $this->findEntities($qb);
	}

	/**
	 * How many recorded missions fall inside a lifetime-counter range.
	 *
	 * Used by the odometer safety net to work out how many of the robot's own
	 * counted missions we actually captured, so it only fills the genuine gap.
	 */
	public function countRecordedBetweenCounters(int $robotId, int $from, int $to): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'n'))
			->from($this->getTableName())
			->where($qb->expr()->eq('robot_id', $qb->createNamedParameter($robotId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->isNotNull('n_mssn_end'))
			->andWhere($qb->expr()->gt('n_mssn_end', $qb->createNamedParameter($from, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->lte('n_mssn_end', $qb->createNamedParameter($to, IQueryBuilder::PARAM_INT)));
		return (int) $qb->executeQuery()->fetchOne();
	}

	public function countEndedBefore(int $cutoffTs): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'n'))
			->from($this->getTableName())
			->where($qb->expr()->isNotNull('ended_at'))
			->andWhere($qb->expr()->lt('ended_at', $qb->createNamedParameter($cutoffTs, IQueryBuilder::PARAM_INT)));
		return (int) $qb->executeQuery()->fetchOne();
	}

	public function deleteOlderThan(int $cutoffTs): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->isNotNull('ended_at'))
			->andWhere($qb->expr()->lt('ended_at', $qb->createNamedParameter($cutoffTs, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
	}
}
