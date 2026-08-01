<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Controller;

use OCA\NcRoomba\AppInfo\Application;
use OCA\NcRoomba\Service\MissionService;
use OCA\NcRoomba\Service\PermissionService;
use OCA\NcRoomba\Service\RobotService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class MissionController extends Controller
{
	public function __construct(
		IRequest $request,
		private PermissionService $permissions,
		private MissionService $missions,
		private RobotService $robots,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * 404 body when `robot_id` names a row that does not exist.
	 *
	 * `robot_id=0` (the default) means "all robots" here, so only a positive id
	 * is checked. Mirrors RobotController::notFound().
	 */
	private function notFound(int $robotId): ?JSONResponse
	{
		if ($robotId <= 0 || $this->robots->robotExists($robotId)) {
			return null;
		}
		return new JSONResponse(
			['error' => 'robot_not_found', 'robot_id' => $robotId],
			Http::STATUS_NOT_FOUND,
		);
	}

	#[NoAdminRequired]
	public function list(): JSONResponse
	{
		$this->permissions->requireOperator();
		$robotId = (int) $this->request->getParam('robot_id', 0);
		if ($missing = $this->notFound($robotId)) {
			return $missing;
		}
		$limit = (int) $this->request->getParam('limit', 50);
		$offset = (int) $this->request->getParam('offset', 0);
		return new JSONResponse($this->missions->listMissions($robotId, $limit, $offset));
	}

	#[NoAdminRequired]
	public function detail(int $id): JSONResponse
	{
		$this->permissions->requireOperator();
		$data = $this->missions->detail($id);
		if ($data === null) {
			return new JSONResponse(['error' => 'not_found'], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse($data);
	}

	#[NoAdminRequired]
	public function export(): DataDisplayResponse|JSONResponse
	{
		$this->permissions->requireOperator();
		$format = (string) $this->request->getParam('format', 'json');
		$robotId = (int) $this->request->getParam('robot_id', 0);
		if ($missing = $this->notFound($robotId)) {
			return $missing;
		}
		$limit = (int) $this->request->getParam('limit', 500);
		$export = $this->missions->export($format, $robotId, $limit);
		$resp = new DataDisplayResponse($export['content'], Http::STATUS_OK);
		$resp->addHeader('Content-Type', $export['content_type']);
		$resp->addHeader('Content-Disposition', 'attachment; filename="' . $export['filename'] . '"');
		return $resp;
	}
}
