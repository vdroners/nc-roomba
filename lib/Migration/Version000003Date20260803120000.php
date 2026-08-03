<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Mission footprint replay — frozen pose trail + covered cells at mission end.
 */
class Version000003Date20260803120000 extends SimpleMigrationStep
{
	/**
	 * @param Closure(): ISchemaWrapper $schemaClosure
	 * @param array<string, mixed> $options
	 */
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('nc_roomba_missions')) {
			$table = $schema->getTable('nc_roomba_missions');
			if (!$table->hasColumn('map_json')) {
				$table->addColumn('map_json', Types::TEXT, [
					'notnull' => false,
				]);
			}
		}

		return $schema;
	}
}
