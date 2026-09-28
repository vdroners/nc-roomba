<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Util;

/**
 * Level conditions that raise a notification, and the edge rule that decides
 * when they do.
 *
 * The sampling job runs in a fresh cron process each tick, so "already told
 * them" cannot live in memory — it is judged from the stored samples instead.
 */
final class AlertEdges
{
	public const LOW_BATTERY_PCT = 15;

	public static function binFull(?string $bin): bool
	{
		return $bin === 'full';
	}

	/** Docked and charging at low battery is expected, not actionable. */
	public static function batteryLow(?int $pct, ?string $phase): bool
	{
		return $pct !== null && $pct <= self::LOW_BATTERY_PCT && $phase !== 'charge';
	}

	/**
	 * True once per episode: the condition holds now and one sample ago, and
	 * did not hold the sample before that. Requiring two readings keeps a
	 * single flapping sample from alerting.
	 */
	public static function confirmedRise(bool $now, bool $previous, bool $before): bool
	{
		return $now && $previous && !$before;
	}
}
