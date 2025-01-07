// ── Cedar Authorizer ─────────────────────────────────────────────────

import type { Policy } from "./parser/ast.js";
import type { EntityStore } from "./entities/store.js";
import type { Request } from "./evaluator/context.js";
import {
  evaluate,
  type AuthorizationResponse,
} from "./evaluator/evaluator.js";
import { parsePolicies } from "./parser/parser.js";

/**
 * High-level authorizer that wraps policy parsing and evaluation.
 *
 * @example
 * ```ts
 * const authorizer = new Authorizer(policies, entityStore);
 * const response = authorizer.isAuthorized({
 *   principal: { type: "User", id: "alice" },
 *   action: { type: "Action", id: "view" },
 *   resource: { type: "Document", id: "doc1" },
 *   context: {},
 * });
 * console.log(response.decision); // "allow" or "deny"
 * ```
 */
export class Authorizer {
  private policies: Policy[];
  private entityStore: EntityStore;

  constructor(policies: Policy[], entityStore: EntityStore) {
    this.policies = policies;
    this.entityStore = entityStore;
  }

  /**
   * Create an Authorizer from raw Cedar policy text.
   */
  static fromText(policyText: string, entityStore: EntityStore): Authorizer {
    const { policies } = parsePolicies(policyText);
    return new Authorizer(policies, entityStore);
  }

  /**
   * Evaluate the request against all policies and return the decision.
   */
  isAuthorized(request: Request): AuthorizationResponse {
    return evaluate(this.policies, this.entityStore, request);
  }

  /**
   * Replace the entity store (useful when entities change).
   */
  setEntityStore(store: EntityStore): void {
    this.entityStore = store;
  }

  /**
   * Add additional policies at runtime.
   */
  addPolicies(policies: Policy[]): void {
    this.policies.push(...policies);
  }

  /**
   * Add policies from Cedar text at runtime.
   */
  addPoliciesFromText(policyText: string): void {
    const { policies } = parsePolicies(policyText);
    this.policies.push(...policies);
  }

  /**
   * Return the current set of policies.
   */
  getPolicies(): ReadonlyArray<Policy> {
    return this.policies;
  }
}
