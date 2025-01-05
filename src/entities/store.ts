// ── Entity Store Interface ───────────────────────────────────────────

import type { EntityUID } from "../evaluator/values.js";
import type { Entity } from "./types.js";

/**
 * Abstraction over entity storage. Implementations can back this
 * with an in-memory map, a database, or any other data source.
 */
export interface EntityStore {
  /**
   * Retrieve an entity by its UID. Returns undefined if not found.
   */
  get(uid: EntityUID): Entity | undefined;

  /**
   * Return the transitive set of ancestor entity UID strings
   * for the given entity. Each string is in the form Type::"id".
   */
  getAncestors(uid: EntityUID): Set<string>;
}
