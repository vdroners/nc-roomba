<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Tests\Unit\Util;

use OCA\NcRoomba\Util\AlertEdges;
use PHPUnit\Framework\TestCase;

class AlertEdgesTest extends TestCase
{
	/**
	 * Walk a sample series through the edge rule the way the cron job does and
	 * return the indices that notify.
	 *
	 * @param list<bool> $levels
	 * @return list<int>
	 */
	private static function firing(array $levels): array
	{
		$fired = [];
		foreach ($levels as $i => $now) {
			$prev = $levels[$i - 1] ?? false;
			$before = $levels[$i - 2] ?? false;
			if (AlertEdges::confirmedRise($now, $prev, $before)) {
				$fired[] = $i;
			}
		}
		return $fired;
	}

	public function testSustainedConditionNotifiesOnce(): void
	{
		// The 2026-09-23 → 09-28 episode: bin full for hundreds of ticks.
		$levels = array_merge([false, false], array_fill(0, 500, true));
		$this->assertSame([3], self::firing($levels));
	}

	public function testReArmsAfterClearing(): void
	{
		$levels = [false, true, true, true, false, false, true, true];
		$this->assertSame([2, 7], self::firing($levels));
	}

	public function testSingleSampleBlipDoesNotNotify(): void
	{
		$this->assertSame([], self::firing([false, true, false, true, false]));
	}

	public function testBinFullPredicate(): void
	{
		$this->assertTrue(AlertEdges::binFull('full'));
		$this->assertFalse(AlertEdges::binFull('ok'));
		$this->assertFalse(AlertEdges::binFull(null));
	}

	public function testLowBatteryIgnoredWhileCharging(): void
	{
		$this->assertTrue(AlertEdges::batteryLow(13, 'stop'));
		$this->assertTrue(AlertEdges::batteryLow(15, null));
		$this->assertFalse(AlertEdges::batteryLow(13, 'charge'));
		$this->assertFalse(AlertEdges::batteryLow(16, 'stop'));
		$this->assertFalse(AlertEdges::batteryLow(null, 'stop'));
	}
}
