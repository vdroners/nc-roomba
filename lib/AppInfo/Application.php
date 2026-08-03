<?php

declare(strict_types=1);

namespace OCA\NcRoomba\AppInfo;

use OCA\NcRoomba\Listener\UninstallCleanupListener;
use OCA\NcRoomba\Middleware\ForbiddenMiddleware;
use OCA\NcRoomba\Notification\Notifier;
use OCP\App\Events\AppUninstallEvent;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

class Application extends App implements IBootstrap
{
	public const APP_ID = 'nc_roomba';
	public const OPERATOR_GROUP = 'roomba-operators';
	public const DEFAULT_BRIDGE_URL = 'http://nc_roomba_bridge:8080';
	public const DEFAULT_RETENTION_DAYS = 365;
	/** Fallback robot display name when none is stored or reported. */
	public const DEFAULT_ROBOT_NAME = 'Roomba';

	public function __construct()
	{
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void
	{
		$context->registerNotifierService(Notifier::class);
		$context->registerMiddleware(ForbiddenMiddleware::class);
		$context->registerEventListener(
			AppUninstallEvent::class,
			UninstallCleanupListener::class,
		);
	}

	/**
	 * Required by IBootstrap — deliberately empty.
	 *
	 * This used to `Util::addStyle(self::APP_ID, 'nc-roomba-theme')`, which put
	 * a nc_roomba stylesheet in the <head> of EVERY Nextcloud page (Files, the
	 * login screen, other apps' settings). The app has no global styling to
	 * contribute: its own tokens live in css/style.scss and are scoped to the
	 * app's roots, loaded only by PageController / AdminSettings.
	 *
	 * Do NOT delete this method to "clean up" — IBootstrap declares it, and a
	 * class that does not implement it fails at runtime in a way `php -l`
	 * cannot see.
	 */
	public function boot(IBootContext $context): void
	{
	}
}
