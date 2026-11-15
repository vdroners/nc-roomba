<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Tests\Unit\Util;

use OCA\NcRoomba\Util\BinFullStopAlert;
use PHPUnit\Framework\TestCase;

class BinFullStopAlertTest extends TestCase
{
	public function testFiresOncePerSeq(): void
	{
		$event = ['fired' => true, 'seq' => 3];
		$this->assertSame(3, BinFullStopAlert::seqToNotify($event, 0));
		$this->assertSame(3, BinFullStopAlert::seqToNotify($event, 2));
		$this->assertNull(BinFullStopAlert::seqToNotify($event, 3));
		$this->assertNull(BinFullStopAlert::seqToNotify($event, 4));
	}

	public function testIgnoresUnfiredOrMissing(): void
	{
		$this->assertNull(BinFullStopAlert::seqToNotify(null, 0));
		$this->assertNull(BinFullStopAlert::seqToNotify(['fired' => false, 'seq' => 1], 0));
		$this->assertNull(BinFullStopAlert::seqToNotify(['fired' => true, 'seq' => 0], 0));
		$this->assertNull(BinFullStopAlert::seqToNotify(['seq' => 1], 0));
	}
}
