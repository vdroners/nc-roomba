<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\IDBConnection;

/** @template-extends QBMapper<Floorplan> */
class FloorplanMapper extends QBMapper
{
	public function __construct(IDBConnection $db)
	{
		parent::__construct($db, 'nc_roomba_floorplans', Floorplan::class);
	}

}
