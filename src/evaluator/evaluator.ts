// ── Cedar Policy Evaluator ───────────────────────────────────────────

import type {
  Policy,
  Expr,
  PrincipalConstraint,
  ActionConstraint,
  ResourceConstraint,
  Condition,
} from "../parser/ast.js";
import type { EntityStore } from "../entities/store.js";
import type { Request } from "./context.js";
import {
  type CedarValue,
  type EntityUID,
  CedarSet,
  entityUIDEquals,
  entityUIDKey,
  cedarValueEquals,
  isEntityUID,
  isCedarSet,
  isCedarRecord,
} from "./values.js";

// ── Public types ─────────────────────────────────────────────────────

export type Decision = "allow" | "deny";

export interface Diagnostics {
  /** IDs of policies that contributed to the decision. */
  reasons: string[];
  /** Errors that occurred during evaluation. */
  errors: EvaluationError[];
}

export interface AuthorizationResponse {
  decision: Decision;
  diagnostics: Diagnostics;
}

/**
 * Error thrown when a policy condition cannot be evaluated.
 * Includes the ID of the policy that caused the error.
 */
export class EvaluationError extends Error {
  constructor(
    message: string,
    public policyId: string,
  ) {
    super(message);
    this.name = "EvaluationError";
  }
}

// ── Evaluator ────────────────────────────────────────────────────────

/**
 * Evaluate a set of Cedar policies against an entity store and request.
 *
 * Implements Cedar's authorization algorithm:
 * 1. Default deny — if no permit matches, the request is denied
 * 2. Forbid overrides permit — any matching forbid causes denial
 * 3. Errors are captured in diagnostics, not thrown
 *
 * @param policies - Parsed Cedar policies to evaluate
 * @param entityStore - Entity store for hierarchy lookups
 * @param request - The authorization request (principal, action, resource, context)
 * @returns Authorization decision with diagnostics
 */
export function evaluate(
  policies: Policy[],
  entityStore: EntityStore,
  request: Request,
): AuthorizationResponse {
  const permits: string[] = [];
  const forbids: string[] = [];
  const errors: EvaluationError[] = [];

  for (const policy of policies) {
    try {
      // Step 1: check scope constraints
      if (!matchesScope(policy, entityStore, request)) continue;

      // Step 2: evaluate conditions
      let satisfied = true;
      for (const cond of policy.conditions) {
        const result = evaluateCondition(cond, policy, entityStore, request);
        if (!result) {
          satisfied = false;
          break;
        }
      }

      if (!satisfied) continue;

      // This policy is satisfied
      if (policy.effect === "permit") {
        permits.push(policy.id);
      } else {
        forbids.push(policy.id);
      }
    } catch (err) {
      errors.push(
        new EvaluationError(
          err instanceof Error ? err.message : String(err),
          policy.id,
        ),
      );
    }
  }

  // Forbid overrides permit
  if (forbids.length > 0) {
    return {
      decision: "deny",
      diagnostics: { reasons: forbids, errors },
    };
  }

  if (permits.length > 0) {
    return {
      decision: "allow",
      diagnostics: { reasons: permits, errors },
    };
  }

  // Default deny
  return {
    decision: "deny",
    diagnostics: { reasons: [], errors },
  };
}

// ── Scope matching ───────────────────────────────────────────────────

function matchesScope(
  policy: Policy,
  store: EntityStore,
  request: Request,
): boolean {
  return (
    matchesPrincipal(policy.principal, store, request.principal) &&
    matchesAction(policy.action, store, request.action) &&
    matchesResource(policy.resource, store, request.resource)
  );
}

function matchesPrincipal(
  constraint: PrincipalConstraint,
  store: EntityStore,
  principal: EntityUID,
): boolean {
  switch (constraint.kind) {
    case "any":
      return true;
    case "eq":
      return entityUIDEquals(principal, {
        type: constraint.entity.type,
        id: constraint.entity.id,
      });
    case "in": {
      const target = { type: constraint.entity.type, id: constraint.entity.id };
      if (entityUIDEquals(principal, target)) return true;
      const ancestors = store.getAncestors(principal);
      return ancestors.has(entityUIDKey(target));
    }
    case "is":
      return principal.type === constraint.entityType;
    case "is_in": {
      if (principal.type !== constraint.entityType) return false;
      const target = { type: constraint.entity.type, id: constraint.entity.id };
      if (entityUIDEquals(principal, target)) return true;
      const ancestors = store.getAncestors(principal);
      return ancestors.has(entityUIDKey(target));
    }
  }
}

function matchesAction(
  constraint: ActionConstraint,
  store: EntityStore,
  action: EntityUID,
): boolean {
  switch (constraint.kind) {
    case "any":
      return true;
    case "eq":
      return entityUIDEquals(action, {
        type: constraint.entity.type,
        id: constraint.entity.id,
      });
    case "in": {
      const target = { type: constraint.entity.type, id: constraint.entity.id };
      if (entityUIDEquals(action, target)) return true;
      const ancestors = store.getAncestors(action);
      return ancestors.has(entityUIDKey(target));
    }
    case "in_set":
      return constraint.entities.some((e) =>
        entityUIDEquals(action, { type: e.type, id: e.id }),
      );
  }
}

function matchesResource(
  constraint: ResourceConstraint,
  store: EntityStore,
  resource: EntityUID,
): boolean {
  switch (constraint.kind) {
    case "any":
      return true;
    case "eq":
      return entityUIDEquals(resource, {
        type: constraint.entity.type,
        id: constraint.entity.id,
      });
    case "in": {
      const target = { type: constraint.entity.type, id: constraint.entity.id };
      if (entityUIDEquals(resource, target)) return true;
      const ancestors = store.getAncestors(resource);
      return ancestors.has(entityUIDKey(target));
    }
    case "is":
      return resource.type === constraint.entityType;
    case "is_in": {
      if (resource.type !== constraint.entityType) return false;
      const target = { type: constraint.entity.type, id: constraint.entity.id };
      if (entityUIDEquals(resource, target)) return true;
      const ancestors = store.getAncestors(resource);
      return ancestors.has(entityUIDKey(target));
    }
  }
}

// ── Condition evaluation ─────────────────────────────────────────────

function evaluateCondition(
  cond: Condition,
  policy: Policy,
  store: EntityStore,
  request: Request,
): boolean {
  const result = evalExpr(cond.body, store, request);
  if (typeof result !== "boolean") {
    throw new EvaluationError(
      `Condition body must evaluate to a boolean, got ${typeof result}`,
      policy.id,
    );
  }
  if (cond.kind === "when") return result;
  // unless: the condition must be false for the policy to apply
  return !result;
}

// ── Expression evaluator ─────────────────────────────────────────────

/**
 * Evaluate a single Cedar expression in the given context.
 *
 * @param expr - The expression AST node to evaluate
 * @param store - Entity store for hierarchy and attribute lookups
 * @param request - The authorization request providing variable bindings
 * @returns The Cedar value produced by the expression
 * @throws {Error} If the expression cannot be evaluated (type errors, missing attributes, etc.)
 */
export function evalExpr(
  expr: Expr,
  store: EntityStore,
  request: Request,
): CedarValue {
  switch (expr.kind) {
    case "literal":
      return expr.value;

    case "entity_uid":
      return { type: expr.type, id: expr.id };

    case "var": {
      switch (expr.name) {
        case "principal":
          return request.principal;
        case "action":
          return request.action;
        case "resource":
          return request.resource;
        case "context":
          return request.context;
      }
      break;
    }

    case "not": {
      const val = evalExpr(expr.operand, store, request);
      if (typeof val !== "boolean") throw new Error("'!' requires a boolean operand");
      return !val;
    }

    case "neg": {
      const val = evalExpr(expr.operand, store, request);
      if (typeof val !== "number") throw new Error("Negation requires a numeric operand");
      return -val;
    }

    case "binary":
      return evalBinary(expr.op, expr.left, expr.right, store, request);

    case "if_then_else": {
      const cond = evalExpr(expr.cond, store, request);
      if (typeof cond !== "boolean") throw new Error("if condition must be boolean");
      return cond
        ? evalExpr(expr.then, store, request)
        : evalExpr(expr.else_, store, request);
    }

    case "in": {
      const left = evalExpr(expr.left, store, request);
      const right = evalExpr(expr.right, store, request);

      if (!isEntityUID(left)) throw new Error("'in' left operand must be an entity");

      // Right can be an entity or a set of entities
      if (isEntityUID(right)) {
        if (entityUIDEquals(left, right)) return true;
        const ancestors = store.getAncestors(left);
        return ancestors.has(entityUIDKey(right));
      }
      if (isCedarSet(right)) {
        for (const elem of right.elements) {
          if (!isEntityUID(elem)) continue;
          if (entityUIDEquals(left, elem)) return true;
          const ancestors = store.getAncestors(left);
          if (ancestors.has(entityUIDKey(elem))) return true;
        }
        return false;
      }
      throw new Error("'in' right operand must be an entity or set of entities");
    }

    case "has": {
      const left = evalExpr(expr.left, store, request);
      if (isEntityUID(left)) {
        const entity = store.get(left);
        if (!entity) return false;
        return expr.attr in entity.attrs;
      }
      if (isCedarRecord(left)) {
        return expr.attr in left;
      }
      throw new Error("'has' requires an entity or record operand");
    }

    case "like": {
      const left = evalExpr(expr.left, store, request);
      if (typeof left !== "string") throw new Error("'like' requires a string operand");
      return matchWildcard(left, expr.pattern);
    }

    case "is": {
      const left = evalExpr(expr.left, store, request);
      if (!isEntityUID(left)) throw new Error("'is' requires an entity operand");
      const typeMatches = left.type === expr.entityType;
      if (!typeMatches) return false;
      if (expr.inExpr) {
        const right = evalExpr(expr.inExpr, store, request);
        if (!isEntityUID(right)) throw new Error("'is ... in' requires an entity");
        if (entityUIDEquals(left, right)) return true;
        const ancestors = store.getAncestors(left);
        return ancestors.has(entityUIDKey(right));
      }
      return true;
    }

    case "get_attr": {
      const left = evalExpr(expr.left, store, request);
      if (isEntityUID(left)) {
        const entity = store.get(left);
        if (!entity) throw new Error(`Entity not found: ${entityUIDKey(left)}`);
        if (!(expr.attr in entity.attrs)) {
          throw new Error(`Attribute '${expr.attr}' not found on ${entityUIDKey(left)}`);
        }
        return entity.attrs[expr.attr]!;
      }
      if (isCedarRecord(left)) {
        if (!(expr.attr in left)) {
          throw new Error(`Attribute '${expr.attr}' not found in record`);
        }
        return left[expr.attr]!;
      }
      throw new Error(`Cannot access attribute '${expr.attr}' on ${typeof left}`);
    }

    case "method_call":
      return evalMethodCall(expr.left, expr.method, expr.args, store, request);

    case "set": {
      const elements = expr.elements.map((e) => evalExpr(e, store, request));
      return new CedarSet(elements);
    }

    case "record": {
      const rec: Record<string, CedarValue> = {};
      for (const { key, value } of expr.pairs) {
        rec[key] = evalExpr(value, store, request);
      }
      return rec;
    }

    case "slot":
      throw new Error("Slot expressions are not supported in evaluation");
  }

  throw new Error(`Unknown expression kind: ${(expr as Expr).kind}`);
}

// ── Binary operators ─────────────────────────────────────────────────

import type { BinaryOp } from "../parser/ast.js";

function evalBinary(
  op: BinaryOp,
  leftExpr: Expr,
  rightExpr: Expr,
  store: EntityStore,
  request: Request,
): CedarValue {
  // Short-circuit for && and ||
  if (op === "&&") {
    const left = evalExpr(leftExpr, store, request);
    if (typeof left !== "boolean") throw new Error("'&&' requires boolean operands");
    if (!left) return false;
    const right = evalExpr(rightExpr, store, request);
    if (typeof right !== "boolean") throw new Error("'&&' requires boolean operands");
    return right;
  }

  if (op === "||") {
    const left = evalExpr(leftExpr, store, request);
    if (typeof left !== "boolean") throw new Error("'||' requires boolean operands");
    if (left) return true;
    const right = evalExpr(rightExpr, store, request);
    if (typeof right !== "boolean") throw new Error("'||' requires boolean operands");
    return right;
  }

  const left = evalExpr(leftExpr, store, request);
  const right = evalExpr(rightExpr, store, request);

  switch (op) {
    case "==":
      return cedarValueEquals(left, right);
    case "!=":
      return !cedarValueEquals(left, right);
    case "<":
      assertNumbers(left, right, op);
      return (left as number) < (right as number);
    case "<=":
      assertNumbers(left, right, op);
      return (left as number) <= (right as number);
    case ">":
      assertNumbers(left, right, op);
      return (left as number) > (right as number);
    case ">=":
      assertNumbers(left, right, op);
      return (left as number) >= (right as number);
    case "+":
      assertNumbers(left, right, op);
      return (left as number) + (right as number);
    case "-":
      assertNumbers(left, right, op);
      return (left as number) - (right as number);
    case "*":
      assertNumbers(left, right, op);
      return (left as number) * (right as number);
  }
}

function assertNumbers(a: CedarValue, b: CedarValue, op: string): void {
  if (typeof a !== "number" || typeof b !== "number") {
    throw new Error(`Operator '${op}' requires numeric operands`);
  }
}

// ── Method calls ─────────────────────────────────────────────────────

function evalMethodCall(
  leftExpr: Expr,
  method: string,
  argExprs: Expr[],
  store: EntityStore,
  request: Request,
): CedarValue {
  const left = evalExpr(leftExpr, store, request);

  switch (method) {
    case "contains": {
      if (!isCedarSet(left)) throw new Error("'contains' requires a set");
      if (argExprs.length !== 1) throw new Error("'contains' takes exactly one argument");
      const arg = evalExpr(argExprs[0]!, store, request);
      return left.contains(arg);
    }

    case "containsAll": {
      if (!isCedarSet(left)) throw new Error("'containsAll' requires a set");
      if (argExprs.length !== 1) throw new Error("'containsAll' takes exactly one argument");
      const arg = evalExpr(argExprs[0]!, store, request);
      if (!isCedarSet(arg)) throw new Error("'containsAll' argument must be a set");
      return left.containsAll(arg);
    }

    case "containsAny": {
      if (!isCedarSet(left)) throw new Error("'containsAny' requires a set");
      if (argExprs.length !== 1) throw new Error("'containsAny' takes exactly one argument");
      const arg = evalExpr(argExprs[0]!, store, request);
      if (!isCedarSet(arg)) throw new Error("'containsAny' argument must be a set");
      return left.containsAny(arg);
    }

    default:
      throw new Error(`Unknown method '${method}'`);
  }
}

// ── Wildcard matching for `like` ─────────────────────────────────────

function matchWildcard(value: string, pattern: string): boolean {
  // Cedar `like` uses `*` as wildcard (matches any sequence of characters)
  // Convert to a regex. The pattern comes from the parser with `\*` for literal stars.
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "\\" && i + 1 < pattern.length && pattern[i + 1] === "*") {
      // Literal star (escaped)
      regex += "\\*";
      i += 2;
    } else if (pattern[i] === "*") {
      regex += ".*";
      i++;
    } else {
      // Escape regex special chars
      regex += pattern[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  regex += "$";

  return new RegExp(regex, "s").test(value);
}
