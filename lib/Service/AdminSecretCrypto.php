<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Service;

use OCA\NcRoomba\AppInfo\Application;
use OCA\NcRoomba\Exception\SecretDecryptException;
use OCP\IConfig;
use OCP\Security\ICrypto;
use Psr\Log\LoggerInterface;

/**
 * Encrypts robot / admin secrets at rest (`enc:v1:` + ICrypto).
 */
class AdminSecretCrypto
{
	public const PREFIX = 'enc:v1:';

	/** @var list<string> */
	public const SECRET_KEYS = [
		'robot_password',
		'home_wifi_password',
	];

	public function __construct(
		private IConfig $config,
		private ICrypto $crypto,
		private LoggerInterface $logger,
	) {
	}

	public function encrypt(string $plain): string
	{
		if ($plain === '') {
			return '';
		}
		return self::PREFIX . $this->crypto->encrypt($plain);
	}

	/**
	 * Unprefixed legacy plaintext passes through unchanged; a `enc:v1:` value
	 * that will not decrypt is an error, never a value.
	 *
	 * Returning the ciphertext here (the pre-0.9.2 behaviour) sent
	 * `enc:v1:<blob>` to the bridge as the MQTT password after a Nextcloud
	 * `secret` rotation, which surfaces as CONNACK 5 and reads to the operator
	 * as "re-onboard the robot" when the credential is in fact fine.
	 *
	 * @param string $key config key, for the log line and the exception — never the value
	 * @throws SecretDecryptException
	 */
	public function decrypt(string $stored, string $key = ''): string
	{
		if ($stored === '' || !str_starts_with($stored, self::PREFIX)) {
			return $stored;
		}
		$payload = substr($stored, strlen(self::PREFIX));
		try {
			return $this->crypto->decrypt($payload);
		} catch (\Throwable $e) {
			$this->logger->warning(
				'AdminSecretCrypto: could not decrypt stored secret {key} — the instance secret was '
				. 'most likely rotated; the value must be re-entered. Error: {err}',
				['key' => $key !== '' ? $key : '(unnamed)', 'err' => $e->getMessage()],
			);
			throw new SecretDecryptException($key, $e);
		}
	}

	/**
	 * @throws SecretDecryptException
	 */
	public function get(string $key, string $default = ''): string
	{
		$raw = (string) $this->config->getAppValue(Application::APP_ID, $key, $default);
		return $this->decrypt($raw, $key);
	}

	public function set(string $key, string $plain): void
	{
		if ($plain === '') {
			$this->config->deleteAppValue(Application::APP_ID, $key);
			return;
		}
		$this->config->setAppValue(Application::APP_ID, $key, $this->encrypt($plain));
	}

	public function isEncrypted(string $stored): bool
	{
		return str_starts_with($stored, self::PREFIX);
	}
}
