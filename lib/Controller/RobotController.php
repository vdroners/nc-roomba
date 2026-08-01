<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Controller;

use OCA\NcRoomba\AppInfo\Application;
use OCA\NcRoomba\Service\BridgeClient;
use OCA\NcRoomba\Service\PermissionService;
use OCA\NcRoomba\Service\RobotService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class RobotController extends Controller
{
	/**
	 * Reconnect interval handed to the browser's EventSource, in milliseconds.
	 * The bridge pushes on MQTT change, so this only bounds how stale a frame
	 * can be between reconnects.
	 */
	private const RETRY_MS = 5000;

	public function __construct(
		IRequest $request,
		private PermissionService $permissions,
		private RobotService $robots,
		private BridgeClient $bridge,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * 404 body for a robot id with no row, or null when the robot exists.
	 *
	 * The bridge ignores `robot_id` entirely, so without this guard
	 * `/api/robots/999/state` returned the real robot's telemetry relabelled 999
	 * and `/api/robots/999/action/clean` would have started the real robot.
	 * Every robot-scoped method calls this first.
	 */
	private function notFound(int $id): ?JSONResponse
	{
		if ($this->robots->robotExists($id)) {
			return null;
		}
		return new JSONResponse(
			['error' => 'robot_not_found', 'robot_id' => $id],
			Http::STATUS_NOT_FOUND,
		);
	}

	#[NoAdminRequired]
	public function state(int $id): JSONResponse
	{
		$this->permissions->requireOperator();
		if ($missing = $this->notFound($id)) {
			return $missing;
		}
		return new JSONResponse($this->robots->getEnrichedState($id));
	}

	#[NoAdminRequired]
	public function action(int $id, string $name): JSONResponse
	{
		$user = $this->permissions->requireOperator();
		if ($missing = $this->notFound($id)) {
			return $missing;
		}
		$result = $this->robots->runAction($id, $name, $user->getUID());
		return new JSONResponse($result['result'], $result['ok'] ? Http::STATUS_OK : Http::STATUS_BAD_REQUEST);
	}

	/**
	 * SSE endpoint: one enriched `state` frame per connection, then close.
	 *
	 * A single-shot frame plus a `retry:` hint, not a held connection. The old
	 * version tried to proxy the bridge's own stream for 25 seconds and got four
	 * things wrong at once:
	 *
	 *  1. `BridgeClient::proxyStream()` echoed straight to output and flushed,
	 *     escaping the `ob_start()` wrapper — so the body went out before
	 *     `addHeader()` ran and the Content-Type stayed `text/html`, which a
	 *     browser EventSource refuses outright. `ob_get_clean()` was dead code
	 *     (always empty), and the log took eleven "headers already sent"
	 *     warnings per request.
	 *  2. The frame itself was built with single quotes, so `\n` reached the wire
	 *     as a literal backslash-n rather than a newline.
	 *  3. Every call ended in a curl timeout after ~25 s, pinning an Apache
	 *     worker for the duration; being GET + NoCSRFRequired made exhausting the
	 *     worker pool from a hostile page trivial.
	 *  4. It could deliver the raw bridge DTO and the enriched one in the same
	 *     stream — two different shapes for the same consumer.
	 *
	 * One frame, correct headers, one shape. The browser reconnects on its own
	 * every RETRY_MS, which costs far less than holding a worker and is fresher
	 * than the store's backup poll.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function stream(int $id): DataDisplayResponse|JSONResponse
	{
		$this->permissions->requireOperator();
		if ($missing = $this->notFound($id)) {
			return $missing;
		}
		$state = $this->robots->getEnrichedState($id);
		// Double quotes matter: single-quoted "\n" is a literal backslash-n, which
		// is what this used to emit — verified on the wire. No EventSource would
		// ever have parsed it.
		$payload = 'retry: ' . self::RETRY_MS . "\n\n"
			. "event: state\n"
			. 'data: ' . json_encode($state, JSON_THROW_ON_ERROR) . "\n\n";

		$resp = new DataDisplayResponse($payload, Http::STATUS_OK);
		$resp->addHeader('Content-Type', 'text/event-stream; charset=utf-8');
		$resp->addHeader('Cache-Control', 'no-cache, no-transform');
		$resp->addHeader('X-Accel-Buffering', 'no');
		return $resp;
	}

	#[NoAdminRequired]
	public function discover(): JSONResponse
	{
		$this->permissions->requireOperator();
		$opts = $this->request->getParams();
		return new JSONResponse($this->robots->discover(is_array($opts) ? $opts : []));
	}

	#[NoAdminRequired]
	public function connectTest(int $id): JSONResponse
	{
		$this->permissions->requireOperator();
		if ($missing = $this->notFound($id)) {
			return $missing;
		}
		$result = $this->robots->connectTest($id);
		return new JSONResponse(
			$result,
			!empty($result['ok']) ? Http::STATUS_OK : Http::STATUS_BAD_GATEWAY,
		);
	}
}
