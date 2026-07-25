<?php

declare(strict_types=1);

namespace OCA\NcRoomba\Exception;

use Exception;

/**
 * Thrown when a caller is not an admin and not in roomba-operators.
 * Mapped to HTTP 403 JSON by ForbiddenMiddleware.
 */
class ForbiddenException extends Exception
{
}
