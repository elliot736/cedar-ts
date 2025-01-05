// ── Request Context ──────────────────────────────────────────────────

import type { EntityUID, CedarRecord } from "./values.js";

/**
 * A Cedar authorization request.
 */
export interface Request {
  principal: EntityUID;
  action: EntityUID;
  resource: EntityUID;
  context: CedarRecord;
}
