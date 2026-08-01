<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Service;

use OCA\NcRoomba\AppInfo\Application;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * HTTP client to the private nc-roomba-bridge (Docker DNS).
 */
class BridgeClient
{
	private const CONNECT_TIMEOUT = 5;
	private const TIMEOUT = 30;

	public function __construct(
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function getBaseUrl(): string
	{
		$url = trim($this->config->getAppValue(
			Application::APP_ID,
			'bridge_url',
			Application::DEFAULT_BRIDGE_URL,
		));
		return rtrim($url !== '' ? $url : Application::DEFAULT_BRIDGE_URL, '/');
	}

	/** @return array{ok:bool,status:int,body:?array,raw:string,error:?string} */
	public function health(): array
	{
		return $this->request('GET', '/health');
	}

	/**
	 * Robot state, with the bridge's envelope already unwrapped.
	 *
	 * `/state` answers `{ok, needs_attention, state:{phase, cycle, battery_pct,
	 * pose, …}}`, so `body` here is the INNER DTO, not the wrapper. This is
	 * deliberate and load-bearing.
	 *
	 * Unwrapping used to be each caller's job, and one caller forgot:
	 * `TelemetrySampleJob` handed the wrapper to `MissionService::ingestState()`,
	 * which reads `phase`/`cycle`/`battery_pct` off the top level. They were all
	 * absent, so `$phase` became `''`, `$cycle` fell to its `?? 'none'` default,
	 * the "is a mission running?" test could never be true, and **no mission row
	 * was ever created in the life of the project** — 516 telemetry rows written
	 * with every meaningful column NULL, and every mission notification dead
	 * behind the same branch. Nothing warned, because the wrapper *is* a valid
	 * array.
	 *
	 * Doing it here means a caller cannot get it wrong. The routes nest
	 * inconsistently — `/health` is flat, `/state` nests under `state`,
	 * `/schedule` under `week` — which is exactly the trap; see `getSchedule()`.
	 *
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function getState(int $robotId = 1): array
	{
		$resp = $this->request('GET', '/state', ['robot_id' => $robotId]);
		if (is_array($resp['body']) && is_array($resp['body']['state'] ?? null)) {
			$resp['body'] = $resp['body']['state'];
		}
		return $resp;
	}

	/**
	 * Drain the bridge's completed-mission journal.
	 *
	 * The bridge is the only component that watches the robot in real time, so
	 * it is the authority on when a mission actually started and stopped.
	 * Nextcloud samples on five-minute cron — measured gaps here run to a median
	 * of 15 minutes and a maximum of 110, against a 28-minute average mission —
	 * so reconstructing missions from samples alone drops short runs entirely.
	 *
	 * `since` is the last journal sequence Nextcloud stored, so a slow, restarted
	 * or day-long-offline Nextcloud simply resumes where it left off.
	 *
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function getMissions(int $since = 0, int $limit = 100): array
	{
		return $this->request('GET', '/missions', [
			'since' => max(0, $since),
			'limit' => max(1, min(500, $limit)),
		]);
	}

	/**
	 * @param array<string, mixed> $payload
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function action(string $name, int $robotId = 1, array $payload = []): array
	{
		$body = array_merge(['robot_id' => $robotId], $payload);
		return $this->request('POST', '/action/' . rawurlencode($name), null, $body);
	}

	/** @return array{ok:bool,status:int,body:?array,raw:string,error:?string} */
	public function getSchedule(int $robotId = 1): array
	{
		return $this->request('GET', '/schedule', ['robot_id' => $robotId]);
	}

	/**
	 * @param array<string, mixed> $week
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function setSchedule(array $week, int $robotId = 1): array
	{
		return $this->request('POST', '/schedule', null, [
			'robot_id' => $robotId,
			'week' => $week,
		]);
	}

	/** @return array{ok:bool,status:int,body:?array,raw:string,error:?string} */
	public function getPreferences(int $robotId = 1): array
	{
		return $this->request('GET', '/preferences', ['robot_id' => $robotId]);
	}

	/**
	 * @param array<string, mixed> $prefs
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function setPreferences(array $prefs, int $robotId = 1): array
	{
		return $this->request('POST', '/preferences', null, [
			'robot_id' => $robotId,
			'preferences' => $prefs,
		]);
	}

	/**
	 * @param array<string, mixed> $opts
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function discover(array $opts = []): array
	{
		// Subnet TCP scan + public-info probes can exceed the default 30s budget.
		return $this->request('POST', '/discover', null, $opts, 90);
	}

	/**
	 * Hold-HOME onboarding: ask bridge to fetch BLID/password from robot.
	 *
	 * @param array{ip?:string,timeout?:int} $opts
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function getPassword(array $opts): array
	{
		return $this->request('POST', '/onboard/get-password', null, $opts);
	}

	/**
	 * Soft-AP Wi-Fi scan via host wifi-helper (Roomba-* SSIDs).
	 *
	 * @param array<string, mixed> $opts
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function softapScan(array $opts = []): array
	{
		return $this->request('POST', '/onboard/softap-scan', null, $opts, 60);
	}

	/**
	 * Soft-AP provision (join robot AP → wlcfg → LAN discover). Long-running.
	 *
	 * @param array<string, mixed> $opts
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function softapProvision(array $opts): array
	{
		return $this->request('POST', '/onboard/softap-provision', null, $opts, 240);
	}

	/** @return array{ok:bool,status:int,body:?array,raw:string,error:?string} */
	public function softapStatus(): array
	{
		return $this->request('GET', '/onboard/softap-status', null, null, 10);
	}

	/**
	 * @param array{blid:string,password:string,ip:string,name?:string} $creds
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function connect(array $creds): array
	{
		return $this->request('POST', '/connect', null, $creds);
	}

	/** @return array{ok:bool,status:int,body:?array,raw:string,error:?string} */
	public function connectTest(int $robotId = 1): array
	{
		return $this->request('POST', '/connect-test', null, ['robot_id' => $robotId]);
	}

	/**
	 * @param array<string, scalar>|null $query
	 * @param array<string, mixed>|null $jsonBody
	 * @return array{ok:bool,status:int,body:?array,raw:string,error:?string}
	 */
	public function request(string $method, string $path, ?array $query = null, ?array $jsonBody = null, ?int $timeoutSeconds = null): array
	{
		$url = $this->getBaseUrl() . $path;
		if ($query !== null && $query !== []) {
			$url .= '?' . http_build_query($query);
		}

		$ch = curl_init($url);
		if ($ch === false) {
			return ['ok' => false, 'status' => 0, 'body' => null, 'raw' => '', 'error' => 'curl_init failed'];
		}

		$headers = ['Accept: application/json'];
		$opts = [
			CURLOPT_CUSTOMREQUEST => strtoupper($method),
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT,
			CURLOPT_TIMEOUT => $timeoutSeconds ?? self::TIMEOUT,
			CURLOPT_FOLLOWLOCATION => false,
		];
		if ($jsonBody !== null) {
			$payload = json_encode($jsonBody, JSON_THROW_ON_ERROR);
			$headers[] = 'Content-Type: application/json';
			$opts[CURLOPT_POSTFIELDS] = $payload;
		}
		$opts[CURLOPT_HTTPHEADER] = $headers;
		curl_setopt_array($ch, $opts);

		$raw = curl_exec($ch);
		$errno = curl_errno($ch);
		$error = $errno !== 0 ? curl_error($ch) : null;
		$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		if ($raw === false) {
			$this->logger->warning('BridgeClient request failed {method} {path}: {err}', [
				'method' => $method,
				'path' => $path,
				'err' => $error ?? 'unknown',
			]);
			return ['ok' => false, 'status' => 0, 'body' => null, 'raw' => '', 'error' => $error ?? 'request failed'];
		}

		$body = null;
		$decoded = json_decode((string) $raw, true);
		if (is_array($decoded)) {
			$body = $decoded;
		}

		return [
			'ok' => $status >= 200 && $status < 300,
			'status' => $status,
			'body' => $body,
			'raw' => (string) $raw,
			'error' => $status >= 200 && $status < 300 ? null : ($body['error'] ?? $body['message'] ?? 'bridge_error'),
		];
	}
}
