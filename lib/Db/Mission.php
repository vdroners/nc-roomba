<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;

/**
 * @method int getRobotId()
 * @method void setRobotId(int $robotId)
 * @method int getStartedAt()
 * @method void setStartedAt(int $startedAt)
 * @method int|null getEndedAt()
 * @method void setEndedAt(?int $endedAt)
 * @method string|null getPhaseFinal()
 * @method void setPhaseFinal(?string $phaseFinal)
 * @method string|null getCycle()
 * @method void setCycle(?string $cycle)
 * @method int|null getSqft()
 * @method void setSqft(?int $sqft)
 * @method int|null getMsnM()
 * @method void setMsnM(?int $msnM)
 * @method string getResult()
 * @method void setResult(string $result)
 * @method int getErrorCode()
 * @method void setErrorCode(int $errorCode)
 * @method int|null getBatteryStart()
 * @method void setBatteryStart(?int $batteryStart)
 * @method int|null getBatteryEnd()
 * @method void setBatteryEnd(?int $batteryEnd)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int|null getBridgeSeq()
 * @method void setBridgeSeq(?int $bridgeSeq)
 * @method string|null getSource()
 * @method void setSource(?string $source)
 * @method int|null getNMssnStart()
 * @method void setNMssnStart(?int $nMssnStart)
 * @method int|null getNMssnEnd()
 * @method void setNMssnEnd(?int $nMssnEnd)
 * @method string|null getMapJson()
 * @method void setMapJson(?string $mapJson)
 */
class Mission extends Entity implements JsonSerializable
{
	protected $robotId;
	protected $startedAt;
	protected $endedAt;
	protected $phaseFinal;
	protected $cycle;
	protected $sqft;
	protected $msnM;
	protected $result;
	protected $errorCode;
	protected $batteryStart;
	protected $batteryEnd;
	protected $createdAt;
	/** Journal sequence when this mission came from the bridge (else null). */
	protected $bridgeSeq;
	/** 'bridge' | 'telemetry' | 'odometer' — how the row was obtained. */
	protected $source;
	protected $nMssnStart;
	protected $nMssnEnd;
	/** JSON snapshot: pose_trail, covered_cells, cell_cm at mission end. */
	protected $mapJson;

	public function __construct()
	{
		$this->addType('robotId', 'integer');
		$this->addType('startedAt', 'integer');
		$this->addType('endedAt', 'integer');
		$this->addType('sqft', 'integer');
		$this->addType('msnM', 'integer');
		$this->addType('errorCode', 'integer');
		$this->addType('batteryStart', 'integer');
		$this->addType('batteryEnd', 'integer');
		$this->addType('bridgeSeq', 'integer');
		$this->addType('nMssnStart', 'integer');
		$this->addType('nMssnEnd', 'integer');
		$this->addType('createdAt', 'integer');
	}

	public function jsonSerialize(): array
	{
		$map = $this->decodeMapSnapshot();
		return [
			'id' => (int) $this->id,
			'robot_id' => (int) $this->robotId,
			'started_at' => (int) $this->startedAt,
			'ended_at' => $this->endedAt !== null ? (int) $this->endedAt : null,
			'phase_final' => $this->phaseFinal,
			'cycle' => $this->cycle,
			'sqft' => $this->sqft !== null ? (int) $this->sqft : null,
			'mssn_m' => $this->msnM !== null ? (int) $this->msnM : null,
			'result' => (string) $this->result,
			'error_code' => (int) $this->errorCode,
			'battery_start' => $this->batteryStart !== null ? (int) $this->batteryStart : null,
			'battery_end' => $this->batteryEnd !== null ? (int) $this->batteryEnd : null,
			'created_at' => (int) $this->createdAt,
			// How this row was obtained, so the UI can be honest about it:
			//   bridge    — the bridge watched both edges over MQTT; timings exact
			//   telemetry — reconstructed from Nextcloud's periodic sampling
			//   odometer  — inferred from the robot's own mission counter moving;
			//               the run definitely happened, but nobody saw it start
			//               or stop, so the times are bounds and not measurements
			'source' => $this->source !== null ? (string) $this->source : null,
			'n_mssn_start' => $this->nMssnStart !== null ? (int) $this->nMssnStart : null,
			'n_mssn_end' => $this->nMssnEnd !== null ? (int) $this->nMssnEnd : null,
			'map_snapshot' => $map,
			'pose_trail' => is_array($map['pose_trail'] ?? null) ? $map['pose_trail'] : [],
			'covered_cells' => is_array($map['covered_cells'] ?? null) ? $map['covered_cells'] : [],
			'cell_cm' => is_numeric($map['cell_cm'] ?? null) ? (int) $map['cell_cm'] : null,
		];
	}

	/** @return array<string, mixed>|null */
	private function decodeMapSnapshot(): ?array
	{
		$raw = $this->mapJson;
		if ($raw === null || $raw === '') {
			return null;
		}
		try {
			$decoded = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			return null;
		}
		return is_array($decoded) ? $decoded : null;
	}
}
