<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<MissionPhaseEvent> */
class MissionPhaseEventMapper extends QBMapper
{
	public function __construct(IDBConnection $db)
	{
		parent::__construct($db, 'nc_roomba_mission_phase_events', MissionPhaseEvent::class);
	}

	/**
	 * The most recent phase event for a mission.
	 *
	 * `ingestState()` only ever needs the last one, but called `findByMission()`
	 * on every telemetry sample and took `array_key_last()` — loading every row
	 * of a growing mission, on the hot path, to read one.
	 */
	public function findLatestForMission(int $missionId): ?MissionPhaseEvent
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('mission_id', $qb->createNamedParameter($missionId, IQueryBuilder::PARAM_INT)))
			->orderBy('ts', 'DESC')
			->addOrderBy('id', 'DESC')
			->setMaxResults(1);
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return MissionPhaseEvent[] */
	public function findByMission(int $missionId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('mission_id', $qb->createNamedParameter($missionId, IQueryBuilder::PARAM_INT)))
			->orderBy('ts', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($qb);
	}

	public function deleteByMissionIds(array $missionIds): int
	{
		if ($missionIds === []) {
			return 0;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->in(
				'mission_id',
				$qb->createNamedParameter($missionIds, IQueryBuilder::PARAM_INT_ARRAY),
			));
		return $qb->executeStatement();
	}
}
