<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Exception;

use RuntimeException;

/**
 * Thrown when a stored `enc:v1:` secret cannot be decrypted — almost always
 * because the Nextcloud instance `secret` was rotated after the value was
 * written.
 *
 * Callers MUST NOT fall back to the stored value: handing the raw ciphertext to
 * the bridge as an MQTT password produces a CONNACK 5 that looks like a wrong
 * robot credential, and pushing it into `wlcfg.pass` over Soft-AP would write a
 * literal `enc:v1:...` string into the robot's Wi-Fi config.
 *
 * The ciphertext is deliberately never part of the message.
 */
class SecretDecryptException extends RuntimeException
{
	public const OPERATOR_MESSAGE =
		'The stored credential could not be decrypted — re-enter it in Admin settings.';

	public function __construct(
		private string $secretKey = '',
		?\Throwable $previous = null,
	) {
		$label = $this->secretKey !== '' ? ' (' . $this->secretKey . ')' : '';
		parent::__construct(self::OPERATOR_MESSAGE . $label, 0, $previous);
	}

	/** @return string config key / field name, never the value */
	public function getSecretKey(): string
	{
		return $this->secretKey;
	}
}
