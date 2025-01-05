// ── Entity Type Definitions ──────────────────────────────────────────

import type { EntityUID, CedarValue } from "../evaluator/values.js";

/**
 * An entity in the Cedar entity store.
 */
export interface Entity {
  uid: EntityUID;
  attrs: Record<string, CedarValue>;
  parents: EntityUID[];
}
