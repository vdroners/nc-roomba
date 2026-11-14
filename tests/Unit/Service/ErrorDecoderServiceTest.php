<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Tests\Unit\Service;

use OCA\NcRoomba\Service\ErrorDecoderService;
use PHPUnit\Framework\TestCase;

class ErrorDecoderServiceTest extends TestCase
{
	private ErrorDecoderService $svc;

	protected function setUp(): void
	{
		$path = dirname(__DIR__, 3) . '/knowledge/error_codes.json';
		$this->svc = new ErrorDecoderService($path);
	}

	public function testNoError(): void
	{
		$d = $this->svc->decode(0, 0);
		$this->assertSame(0, $d['code']);
		$this->assertSame('none', $d['kind']);
		$this->assertSame('', $d['title']);
	}

	public function testKnownError(): void
	{
		$d = $this->svc->decode(18, 0);
		$this->assertSame('error', $d['kind']);
		$this->assertSame(18, $d['code']);
		$this->assertNotSame('', $d['title']);
		$this->assertStringContainsString('bin', strtolower($d['title']));
	}

	public function testNotReady(): void
	{
		$d = $this->svc->decode(0, 2);
		$this->assertSame('not_ready', $d['kind']);
		$this->assertSame(2, $d['code']);
		$this->assertNotSame('', $d['title']);
	}

	public function testNotReady16IsBinFull(): void
	{
		$d = $this->svc->decode(0, 16);
		$this->assertSame('bin_full', $d['kind']);
		$this->assertSame(16, $d['code']);
		$this->assertStringContainsString('bin full', strtolower($d['title']));
		$this->assertStringNotContainsString('docked', strtolower($d['title']));
		$this->assertStringContainsString('empty', strtolower($d['action']));
	}

	public function testBinFullFlagOutranksOtherNotReady(): void
	{
		// Live 960 sample 2026-11-14: phase=charge, notReady=16, bin.full=true.
		$d = $this->svc->decode(0, 15, 'full');
		$this->assertSame('bin_full', $d['kind']);
		$this->assertSame(0, $d['code']);
		$d = $this->svc->decode(0, 0, 'full');
		$this->assertSame('bin_full', $d['kind']);
	}

	public function testRealErrorStillWinsOverBinFull(): void
	{
		$d = $this->svc->decode(5, 16, 'full');
		$this->assertSame('error', $d['kind']);
		$this->assertSame(5, $d['code']);
	}

	public function testEmptiedBinClearsBackToReady(): void
	{
		$d = $this->svc->decode(0, 0, 'ok');
		$this->assertSame('none', $d['kind']);
		$d = $this->svc->decode(0, 15, 'ok');
		$this->assertSame('not_ready', $d['kind']);
	}

	public function testUnknownFallsBack(): void
	{
		$d = $this->svc->decode(9999, 0);
		$this->assertSame('error', $d['kind']);
		$this->assertStringContainsString('Unknown', $d['title']);
	}
}
