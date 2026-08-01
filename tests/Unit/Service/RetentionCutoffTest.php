<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Tests\Unit\Service;

use OCA\NcRoomba\Service\MissionService;
use PHPUnit\Framework\TestCase;

/**
 * The retention cutoff — a latent "delete everything" bug.
 *
 * `$cutoff = $retentionDays <= 0 ? time() + 1 : …` meant a retention of **0**
 * produced a cutoff one second in the *future*, so the prune deleted every
 * mission, every telemetry sample and every audit row — including ones written
 * moments earlier. Zero is precisely what an admin types meaning "keep
 * forever", and the settings field is `<input type="number" min="0">`, so it was
 * reachable from the UI in one keystroke.
 *
 * Verified against the live install before the fix: `retentionDryRun(0)`
 * returned `cutoff = now + 1` and would have taken all 516 telemetry rows.
 */
final class RetentionCutoffTest extends TestCase
{
	public function testZeroDaysDeletesNothingRatherThanEverything(): void
	{
		self::assertNull(
			MissionService::cutoffFor(0),
			'0 days must mean "keep everything", never "delete everything"',
		);
	}

	public function testNegativeDaysAlsoDeletesNothing(): void
	{
		self::assertNull(MissionService::cutoffFor(-1));
		self::assertNull(MissionService::cutoffFor(-3650));
	}

	public function testTheCutoffIsNeverInTheFuture(): void
	{
		// The original defect in one assertion.
		foreach ([0, -1, 1, 7, 365, 100000] as $days) {
			$cutoff = MissionService::cutoffFor($days);
			if ($cutoff !== null) {
				self::assertLessThan(
					time(),
					$cutoff,
					"retention of {$days} days produced a cutoff at or after now",
				);
			}
		}
	}

	public function testTheCutoffNeverComesWithinAnHourOfNow(): void
	{
		// Backstop: even a misconfigured tiny retention must not be able to erase
		// data that is still being written. An in-flight mission's samples are
		// worth more than strict adherence to a one-day setting.
		$cutoff = MissionService::cutoffFor(1);
		self::assertNotNull($cutoff);
		self::assertLessThanOrEqual(time() - 3600, $cutoff);
	}

	public function testAnOrdinaryRetentionIsHonoured(): void
	{
		$days = 30;
		$cutoff = MissionService::cutoffFor($days);
		self::assertNotNull($cutoff);

		// Within a second of the expected boundary (the clock moves between the
		// call and this assertion).
		self::assertEqualsWithDelta(time() - ($days * 86400), $cutoff, 2.0);
	}

	public function testLongerRetentionKeepsMore(): void
	{
		$week = MissionService::cutoffFor(7);
		$year = MissionService::cutoffFor(365);
		self::assertNotNull($week);
		self::assertNotNull($year);
		self::assertGreaterThan($year, $week, 'a shorter retention must cut closer to now');
	}
}
