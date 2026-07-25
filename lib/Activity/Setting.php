<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Activity;

use OCA\NcRoomba\AppInfo\Application;
use OCP\Activity\ISetting;
use OCP\IL10N;

class Setting implements ISetting
{
	public function __construct(
		private IL10N $l,
	) {
	}

	public function getIdentifier(): string
	{
		return Application::APP_ID;
	}

	public function getName(): string
	{
		return $this->l->t('A Roomba mission completes, errors, or needs attention');
	}

	public function getPriority(): int
	{
		return 60;
	}

	public function canChangeStream(): bool
	{
		return true;
	}

	public function isDefaultEnabledStream(): bool
	{
		return true;
	}

	public function canChangeMail(): bool
	{
		return true;
	}

	public function isDefaultEnabledMail(): bool
	{
		return false;
	}
}
