// ── In-Memory Entity Store ───────────────────────────────────────────

import { entityUIDKey } from "../evaluator/values.js";
import type { EntityUID } from "../evaluator/values.js";
import type { Entity } from "./types.js";
import type { EntityStore } from "./store.js";

/**
 * An in-memory implementation of EntityStore backed by a Map.
 * Computes transitive ancestry on demand and caches results.
 */
export class MemoryEntityStore implements EntityStore {
  private entities: Map<string, Entity> = new Map();
  private ancestorCache: Map<string, Set<string>> = new Map();

  constructor(entities: Entity[] = []) {
    for (const entity of entities) {
      this.add(entity);
    }
  }

  /**
   * Add an entity to the store. Clears ancestor cache.
   */
  add(entity: Entity): void {
    this.entities.set(entityUIDKey(entity.uid), entity);
    this.ancestorCache.clear();
  }

  /**
   * Remove an entity from the store by UID.
   */
  remove(uid: EntityUID): boolean {
    this.ancestorCache.clear();
    return this.entities.delete(entityUIDKey(uid));
  }

  get(uid: EntityUID): Entity | undefined {
    return this.entities.get(entityUIDKey(uid));
  }

  getAncestors(uid: EntityUID): Set<string> {
    const key = entityUIDKey(uid);
    const cached = this.ancestorCache.get(key);
    if (cached) return cached;

    const ancestors = new Set<string>();
    this.collectAncestors(uid, ancestors, new Set<string>());
    this.ancestorCache.set(key, ancestors);
    return ancestors;
  }

  private collectAncestors(
    uid: EntityUID,
    ancestors: Set<string>,
    visited: Set<string>,
  ): void {
    const key = entityUIDKey(uid);
    if (visited.has(key)) return; // cycle protection
    visited.add(key);

    const entity = this.entities.get(key);
    if (!entity) return;

    for (const parent of entity.parents) {
      const parentKey = entityUIDKey(parent);
      ancestors.add(parentKey);
      this.collectAncestors(parent, ancestors, visited);
    }
  }

  /**
   * Return the number of entities in the store.
   */
  get size(): number {
    return this.entities.size;
  }
}
