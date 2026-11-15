<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Util;

/**
 * Decide whether a bridge bin-full-stop event should raise a notification.
 *
 * The sampling job runs in a fresh process each tick, so the "already told
 * them" cursor lives in appconfig and is passed in as $lastSeq.
 */
final class BinFullStopAlert
{
	/**
	 * @param array<string, mixed>|null $event state.bin_full_stop
	 * @return int|null the seq to record when a notification should fire
	 */
	public static function seqToNotify(?array $event, int $lastSeq): ?int
	{
		if ($event === null) {
			return null;
		}
		$seq = (int) ($event['seq'] ?? 0);
		if ($seq <= 0 || empty($event['fired'])) {
			return null;
		}
		if ($seq <= $lastSeq) {
			return null;
		}
		return $seq;
	}
}
