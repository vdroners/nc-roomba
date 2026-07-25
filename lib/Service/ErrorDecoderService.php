<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Service;

/**
 * Loads knowledge/error_codes.json and decodes Roomba error / notReady codes.
 */
class ErrorDecoderService
{
	private ?array $catalog = null;

	public function __construct(
		private ?string $catalogPath = null,
	) {
		$this->catalogPath ??= dirname(__DIR__, 2) . '/knowledge/error_codes.json';
	}

	/**
	 * @return array{code:int,kind:string,title:string,detail:string,action:string}
	 */
	public function decode(int $error, int $notReady = 0): array
	{
		$catalog = $this->load();
		if ($error !== 0) {
			$entry = $catalog['errors'][(string) $error]
				?? $catalog['errors'][$error]
				?? null;
			if (is_array($entry)) {
				return [
					'code' => $error,
					'kind' => 'error',
					'title' => (string) ($entry['title'] ?? ('Error ' . $error)),
					'detail' => (string) ($entry['detail'] ?? ''),
					'action' => (string) ($entry['action'] ?? ''),
				];
			}
			return [
				'code' => $error,
				'kind' => 'error',
				'title' => 'Unknown error ' . $error,
				'detail' => 'No catalog entry for this error code.',
				'action' => 'Check Alfred status lights and retry; consult OPERATOR.md.',
			];
		}
		if ($notReady !== 0) {
			$entry = $catalog['not_ready'][(string) $notReady]
				?? $catalog['not_ready'][$notReady]
				?? null;
			if (is_array($entry)) {
				return [
					'code' => $notReady,
					'kind' => 'not_ready',
					'title' => (string) ($entry['title'] ?? ('Not ready ' . $notReady)),
					'detail' => (string) ($entry['detail'] ?? ''),
					'action' => (string) ($entry['action'] ?? ''),
				];
			}
			return [
				'code' => $notReady,
				'kind' => 'not_ready',
				'title' => 'Not ready ' . $notReady,
				'detail' => 'No catalog entry for this notReady code.',
				'action' => 'Wait a moment and retry the command.',
			];
		}
		return [
			'code' => 0,
			'kind' => 'none',
			'title' => '',
			'detail' => '',
			'action' => '',
		];
	}

	/** @return array{errors:array<string,array>,not_ready:array<string,array>} */
	public function load(): array
	{
		if ($this->catalog !== null) {
			return $this->catalog;
		}
		$path = $this->catalogPath ?? '';
		if ($path === '' || !is_file($path)) {
			$this->catalog = ['errors' => [], 'not_ready' => []];
			return $this->catalog;
		}
		$raw = file_get_contents($path);
		$data = json_decode($raw !== false ? $raw : '{}', true);
		if (!is_array($data)) {
			$this->catalog = ['errors' => [], 'not_ready' => []];
			return $this->catalog;
		}
		$this->catalog = [
			'errors' => is_array($data['errors'] ?? null) ? $data['errors'] : [],
			'not_ready' => is_array($data['not_ready'] ?? null) ? $data['not_ready'] : [],
		];
		return $this->catalog;
	}
}
