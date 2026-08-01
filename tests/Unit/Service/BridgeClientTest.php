<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Tests\Unit\Service;

use OCA\NcRoomba\Service\BridgeClient;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Regression cover for the bug that broke mission History for the entire life
 * of the project.
 *
 * `/state` answers `{ok, needs_attention, state:{…}}`. Unwrapping that envelope
 * used to be every caller's job, and `TelemetrySampleJob` forgot — it handed the
 * wrapper to `MissionService::ingestState()`, which reads `phase`, `cycle` and
 * `battery_pct` off the top level. All three were absent, so the "is a mission
 * running?" test was permanently false, no mission was ever recorded, and 516
 * telemetry rows were written with every meaningful column NULL.
 *
 * Nothing caught it because the wrapper *is* a valid array, and there was no
 * test of `BridgeClient` at all. The unwrap now lives in `getState()` so a
 * caller cannot get it wrong, and these tests pin that.
 */
final class BridgeClientTest extends TestCase
{
	private function client(array $response): BridgeClient
	{
		$config = $this->createMock(IConfig::class);

		$logger = $this->createMock(LoggerInterface::class);

		// Override only the transport, so the unwrap logic under test is real.
		return new class ($config, $logger, $response) extends BridgeClient {
			public function __construct(IConfig $config, LoggerInterface $logger, private array $canned)
			{
				parent::__construct($config, $logger);
			}

			public function request(string $method, string $path, ?array $query = null, ?array $jsonBody = null, ?int $timeoutSeconds = null): array
			{
				return $this->canned;
			}
		};
	}

	private function envelope(array $body): array
	{
		return ['ok' => true, 'status' => 200, 'body' => $body, 'raw' => '', 'error' => null];
	}

	public function testGetStateUnwrapsTheEnvelopeSoCallersSeeTheDto(): void
	{
		$client = $this->client($this->envelope([
			'ok' => true,
			'needs_attention' => false,
			'state' => ['phase' => 'run', 'cycle' => 'clean', 'battery_pct' => 62],
		]));

		$body = $client->getState(1)['body'];

		// The fields the ingest reads must be at the top level of `body`.
		self::assertSame('run', $body['phase']);
		self::assertSame('clean', $body['cycle']);
		self::assertSame(62, $body['battery_pct']);
		self::assertArrayNotHasKey('state', $body, 'the envelope must not survive');
	}

	public function testTheWrapperShapeIsNeverReturned(): void
	{
		// The precise failure: a caller doing `$state['phase'] ?? ''` against the
		// wrapper silently got '' and concluded the robot was idle. Assert the
		// envelope keys are gone so that can no longer happen.
		$body = $this->client($this->envelope([
			'ok' => true,
			'needs_attention' => true,
			'state' => ['phase' => 'charge', 'cycle' => 'none'],
		]))->getState(1)['body'];

		self::assertArrayNotHasKey('needs_attention', $body);
		self::assertNotSame('', $body['phase'] ?? '');
	}

	public function testAFlatDtoIsPassedThroughUnchanged(): void
	{
		// Tolerate a bridge that ever answers without the wrapper.
		$flat = ['phase' => 'stop', 'cycle' => 'none', 'battery_pct' => 10];
		self::assertSame($flat, $this->client($this->envelope($flat))->getState(1)['body']);
	}

	public function testAFailedRequestIsLeftAloneRatherThanInvented(): void
	{
		$failed = ['ok' => false, 'status' => 0, 'body' => null, 'raw' => '', 'error' => 'Could not resolve host'];
		$resp = $this->client($failed)->getState(1);

		self::assertFalse($resp['ok']);
		self::assertNull($resp['body'], 'a transport failure must not become an empty-but-valid state');
		self::assertSame('Could not resolve host', $resp['error']);
	}

	public function testGetMissionsPassesTheCursorAndClampsTheLimit(): void
	{
		$captured = [];
		$config = $this->createMock(IConfig::class);
		$logger = $this->createMock(LoggerInterface::class);

		$client = new class ($config, $logger, $captured) extends BridgeClient {
			public array $seen = [];

			public function __construct(IConfig $config, LoggerInterface $logger, array $ignored)
			{
				parent::__construct($config, $logger);
			}

			public function request(string $method, string $path, ?array $query = null, ?array $jsonBody = null, ?int $timeoutSeconds = null): array
			{
				$this->seen = ['path' => $path, 'query' => $query];
				return ['ok' => true, 'status' => 200, 'body' => ['missions' => []], 'raw' => '', 'error' => null];
			}
		};

		$client->getMissions(7, 9999);
		self::assertSame('/missions', $client->seen['path']);
		self::assertSame(7, $client->seen['query']['since']);
		self::assertSame(500, $client->seen['query']['limit'], 'limit is clamped');

		$client->getMissions(-5, 0);
		self::assertSame(0, $client->seen['query']['since'], 'a negative cursor cannot rewind past the start');
		self::assertSame(1, $client->seen['query']['limit']);
	}
}
