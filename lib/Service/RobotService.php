<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Service;

use OCA\NcRoomba\AppInfo\Application;
use OCA\NcRoomba\Db\Robot;
use OCA\NcRoomba\Db\RobotMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IConfig;

class RobotService
{
	/** @var list<string> */
	public const ALLOWED_ACTIONS = ['clean', 'spot', 'pause', 'resume', 'stop', 'dock', 'find'];

	public function __construct(
		private RobotMapper $robots,
		private BridgeClient $bridge,
		private AdminSecretCrypto $crypto,
		private ErrorDecoderService $errors,
		private MaintenanceHintService $maintenance,
		private AuditService $audit,
		private IConfig $config,
	) {
	}

	public function getRetentionDays(): int
	{
		$raw = trim($this->config->getAppValue(
			Application::APP_ID,
			'retention_days',
			(string) Application::DEFAULT_RETENTION_DAYS,
		));
		$days = (int) ($raw !== '' ? $raw : Application::DEFAULT_RETENTION_DAYS);
		return max(0, $days);
	}

	public function setRetentionDays(int $days): void
	{
		$this->config->setAppValue(Application::APP_ID, 'retention_days', (string) max(0, $days));
	}

	public function getBridgeUrl(): string
	{
		return $this->bridge->getBaseUrl();
	}

	public function setBridgeUrl(string $url): void
	{
		$this->config->setAppValue(Application::APP_ID, 'bridge_url', rtrim(trim($url), '/'));
	}

	public function getOperatorGroup(): string
	{
		$g = trim($this->config->getAppValue(
			Application::APP_ID,
			'operator_group',
			Application::OPERATOR_GROUP,
		));
		return $g !== '' ? $g : Application::OPERATOR_GROUP;
	}

	public function setOperatorGroup(string $group): void
	{
		$this->config->setAppValue(Application::APP_ID, 'operator_group', trim($group));
	}

	/** @return Robot[] */
	public function listRobots(): array
	{
		return $this->robots->findAll();
	}

	public function getRobot(int $id): ?Robot
	{
		try {
			return $this->robots->find($id);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	public function getPrimaryRobot(): ?Robot
	{
		return $this->robots->findFirst();
	}

	/**
	 * @param array{name?:string,blid:string,password:string,host:string,port?:int,has_pose?:bool} $data
	 */
	public function upsertRobot(array $data, ?int $id = null): Robot
	{
		$now = time();
		$robot = null;
		if ($id !== null) {
			$robot = $this->getRobot($id);
		}
		if ($robot === null) {
			$robot = $this->robots->findFirst();
		}
		if ($robot === null) {
			$robot = new Robot();
			$robot->setCreatedAt($now);
		}

		$robot->setName((string) ($data['name'] ?? $robot->getName() ?: 'Alfred'));
		$robot->setBlid((string) $data['blid']);
		$robot->setHost((string) $data['host']);
		$robot->setPort((int) ($data['port'] ?? 8883));
		if (array_key_exists('has_pose', $data)) {
			$robot->setHasPose(!empty($data['has_pose']) ? 1 : 0);
		} elseif ($robot->getId() === null) {
			$robot->setHasPose(0);
		}
		if (isset($data['password']) && $data['password'] !== '') {
			$robot->setPasswordEnc($this->crypto->encrypt((string) $data['password']));
		} elseif ($robot->getId() === null) {
			$robot->setPasswordEnc('');
		}
		$robot->setUpdatedAt($now);

		if ($robot->getId() === null) {
			return $this->robots->insert($robot);
		}
		return $this->robots->update($robot);
	}

	public function getPlainPassword(Robot $robot): string
	{
		return $this->crypto->decrypt($robot->getPasswordEnc());
	}

	public function setFloorplanPath(int $robotId, string $path): ?Robot
	{
		$robot = $this->getRobot($robotId);
		if ($robot === null) {
			return null;
		}
		$robot->setFloorplanPath($path);
		$robot->setUpdatedAt(time());
		return $this->robots->update($robot);
	}

	/**
	 * Enriched live state for the GUI.
	 *
	 * @return array<string, mixed>
	 */
	public function getEnrichedState(int $robotId): array
	{
		$robot = $this->getRobot($robotId);
		$bridge = $this->bridge->getState($robotId);
		$health = $this->bridge->health();

		$state = is_array($bridge['body']) ? $bridge['body'] : [];
		// Bridge may wrap as { ok, state } (index.js) or return the DTO flat.
		if (isset($state['state']) && is_array($state['state'])) {
			$state = $state['state'];
		}
		if ($robot !== null) {
			$state['robot_id'] = (int) $robot->getId();
			$state['name'] = $robot->getName();
			$state['has_pose'] = (bool) $robot->getHasPose() || !empty($state['has_pose']);
			$state['floorplan_path'] = $robot->getFloorplanPath();
		} else {
			$state['robot_id'] = $robotId;
			$state['name'] = (string) ($state['name'] ?? 'Alfred');
		}

		$error = (int) ($state['error'] ?? 0);
		$notReady = (int) ($state['not_ready'] ?? $state['notReady'] ?? 0);
		$state['decoded_error'] = $this->errors->decode($error, $notReady);

		$conflict = $state['conflict'] ?? ($health['body']['conflict'] ?? null);
		$mqtt = 'down';
		if (!empty($state['connected']) || !empty($health['body']['connected'])) {
			$mqtt = 'up';
		}
		if ($conflict) {
			$mqtt = 'conflict';
		}
		$updatedAt = (string) ($state['updated_at'] ?? '');
		$stale = false;
		if ($updatedAt !== '') {
			$ts = strtotime($updatedAt);
			if ($ts !== false && (time() - $ts) > 45) {
				$stale = true;
			}
		}

		$last = $this->audit->latest($robotId);
		$state['connection_health'] = [
			'mqtt' => $mqtt,
			'stale' => $stale,
			'bridge_ok' => $health['ok'],
			'conflict' => $conflict,
			'last_command' => $last?->jsonSerialize() ?? new \stdClass(),
			'recovery' => [
				'Close the iRobot mobile app (single MQTT connection).',
				'Wait 30 seconds, then Retry connect.',
				'Confirm DHCP reservation for Alfred.',
				'From the host: nc -zv <alfred-ip> 8883',
			],
		];

		$scheduleBody = $this->bridge->getSchedule($robotId);
		$week = is_array($scheduleBody['body']['week'] ?? null)
			? $scheduleBody['body']['week']
			: (is_array($scheduleBody['body'] ?? null) ? $scheduleBody['body'] : []);
		$state['next_scheduled'] = $this->computeNextScheduled($week);
		$state['maintenance_hints'] = $this->maintenance->hintsFor(
			is_array($state['bbrun'] ?? null) ? $state['bbrun'] : [],
			[
				'bin' => $state['bin'] ?? null,
				'battery_pct' => $state['battery_pct'] ?? null,
			],
		);
		$state['bridge_error'] = $bridge['ok'] ? null : ($bridge['error'] ?? 'bridge_unreachable');
		return $state;
	}

	/**
	 * @param array<string, mixed> $week dorita980 setWeek shape
	 * @return array{day:?string,local_time:?string,server_offset_min:int}|null
	 */
	public function computeNextScheduled(array $week): ?array
	{
		$cycle = $week['cycle'] ?? null;
		$h = $week['h'] ?? null;
		$m = $week['m'] ?? null;
		if (!is_array($cycle) || !is_array($h) || !is_array($m)) {
			return null;
		}
		$days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		$now = new \DateTimeImmutable('now');
		$serverOffset = (int) round(((int) $now->format('Z')) / 60);
		$best = null;
		$bestTs = null;
		for ($offset = 0; $offset < 8; $offset++) {
			$candidate = $now->modify('+' . $offset . ' day');
			$dow = (int) $candidate->format('w'); // 0=Sun
			$c = (string) ($cycle[$dow] ?? 'none');
			if ($c === '' || $c === 'none') {
				continue;
			}
			$hh = (int) ($h[$dow] ?? 0);
			$mm = (int) ($m[$dow] ?? 0);
			$start = $candidate->setTime($hh, $mm, 0);
			if ($start <= $now) {
				continue;
			}
			$ts = $start->getTimestamp();
			if ($bestTs === null || $ts < $bestTs) {
				$bestTs = $ts;
				$best = [
					'day' => $days[$dow],
					'local_time' => sprintf('%02d:%02d', $hh, $mm),
					'server_offset_min' => $serverOffset,
				];
			}
		}
		return $best;
	}

	/**
	 * @return array{ok:bool,result:array<string,mixed>}
	 */
	public function runAction(int $robotId, string $action, string $uid): array
	{
		$action = strtolower($action);
		if (!in_array($action, self::ALLOWED_ACTIONS, true)) {
			$this->audit->write($robotId, $uid, $action, 'rejected', ['reason' => 'unsupported_action']);
			return ['ok' => false, 'result' => ['error' => 'unsupported_action', 'action' => $action]];
		}
		$resp = $this->bridge->action($action, $robotId);
		$result = $resp['ok'] ? 'ok' : 'error';
		$this->audit->write($robotId, $uid, $action, $result, [
			'status' => $resp['status'],
			'body' => $resp['body'],
			'error' => $resp['error'],
		]);
		return [
			'ok' => $resp['ok'],
			'result' => $resp['body'] ?? ['error' => $resp['error'], 'status' => $resp['status']],
		];
	}

	/** @return array{ok:bool,robots:list<array<string,mixed>>,error:?string} */
	public function discover(array $opts = []): array
	{
		$resp = $this->bridge->discover($opts);
		$robots = [];
		if (is_array($resp['body']['robots'] ?? null)) {
			$robots = $resp['body']['robots'];
		} elseif (is_array($resp['body'] ?? null) && array_is_list($resp['body'])) {
			$robots = $resp['body'];
		}
		return [
			'ok' => $resp['ok'],
			'robots' => $robots,
			'error' => $resp['error'],
		];
	}

	/**
	 * @param array{ip:string,name?:string,timeout?:int} $opts
	 * @return array<string, mixed>
	 */
	public function onboard(array $opts): array
	{
		$pw = $this->bridge->getPassword($opts);
		if (!$pw['ok'] || !is_array($pw['body'])) {
			return ['ok' => false, 'error' => $pw['error'] ?? 'get_password_failed', 'body' => $pw['body']];
		}
		$body = $pw['body'];
		$blid = (string) ($body['blid'] ?? $body['username'] ?? '');
		$password = (string) ($body['password'] ?? '');
		$ip = (string) ($opts['ip'] ?? $body['ip'] ?? '');
		if ($blid === '' || $password === '' || $ip === '') {
			return ['ok' => false, 'error' => 'incomplete_credentials', 'body' => $body];
		}
		$robot = $this->upsertRobot([
			'name' => (string) ($opts['name'] ?? $body['name'] ?? 'Alfred'),
			'blid' => $blid,
			'password' => $password,
			'host' => $ip,
			'port' => 8883,
		]);
		$connect = $this->bridge->connect([
			'blid' => $blid,
			'password' => $password,
			'ip' => $ip,
			'name' => $robot->getName(),
			'robot_id' => (int) $robot->getId(),
		]);
		return [
			'ok' => $connect['ok'],
			'robot' => $robot->jsonSerialize(),
			'connect' => $connect['body'],
			'error' => $connect['error'],
		];
	}

	/** @return array<string, mixed> */
	public function adminBootstrap(): array
	{
		$primary = $this->getPrimaryRobot();
		return [
			'bridge_url' => $this->getBridgeUrl(),
			'operator_group' => $this->getOperatorGroup(),
			'retention_days' => $this->getRetentionDays(),
			'robot' => $primary?->jsonSerialize(),
		];
	}
}
