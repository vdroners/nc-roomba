<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Exception;

use RuntimeException;

/**
 * Thrown when a caller names a robot id that has no row.
 *
 * The bridge is single-robot and ignores `robot_id` entirely, so silently
 * falling back to the primary robot means a request for robot 999 drives the
 * real robot and files the audit row under a robot that does not exist.
 */
class RobotNotFoundException extends RuntimeException
{
	public function __construct(private int $robotId)
	{
		parent::__construct('No robot with id ' . $robotId . '.');
	}

	public function getRobotId(): int
	{
		return $this->robotId;
	}
}
