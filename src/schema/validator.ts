// ── Cedar Schema Validator ───────────────────────────────────────────
//
// Validates parsed Cedar policies against a schema without evaluating.
// Checks entity types exist, attribute accesses are valid, and operators
// are applied to compatible types.

import type {
  Policy,
  Expr,
  PrincipalConstraint,
  ActionConstraint,
  ResourceConstraint,
  Span,
} from "../parser/ast.js";
import type {
  CedarSchema,
  RecordTypeSchema,
} from "./schema.js";

// ── Public types ─────────────────────────────────────────────────────

export interface ValidationError {
  message: string;
  policyId: string;
  span?: Span;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ── Inferred types for the type checker ──────────────────────────────

type InferredType =
  | "Boolean"
  | "Long"
  | "String"
  | "Entity"
  | "Set"
  | "Record"
  | "Any"       // unknown or could not determine
  | "EntityUID"; // same as Entity for our purposes

// ── Validator ────────────────────────────────────────────────────────

/**
 * Validate parsed Cedar policies against a schema without evaluating them.
 *
 * Checks that all entity types, actions, and attribute accesses are valid,
 * and that operators are applied to compatible types.
 *
 * @param policies - Parsed Cedar policies to validate
 * @param schema - The Cedar schema defining valid entity types, actions, and attributes
 * @returns A validation result indicating whether the policies are valid and any errors found
 */
export function validatePolicies(
  policies: Policy[],
  schema: CedarSchema,
): ValidationResult {
  const errors: ValidationError[] = [];
  const ns = schema.namespace ?? "";

  function qualify(name: string): string {
    if (!ns || name.includes("::")) return name;
    return `${ns}::${name}`;
  }

  function entityTypeExists(typeName: string): boolean {
    // Try both qualified and unqualified
    return (
      typeName in schema.entityTypes ||
      qualify(typeName) in schema.entityTypes ||
      // Action is a special built-in type
      typeName === "Action"
    );
  }

  function getEntityShape(typeName: string): RecordTypeSchema | undefined {
    const et =
      schema.entityTypes[typeName] ?? schema.entityTypes[qualify(typeName)];
    return et?.shape;
  }

  function addError(policyId: string, message: string, span?: Span): void {
    errors.push({ message, policyId, span });
  }

  // ── Validate scope constraints ─────────────────────────────────────

  function validatePrincipal(
    c: PrincipalConstraint,
    policyId: string,
  ): void {
    switch (c.kind) {
      case "eq":
      case "in":
        if (!entityTypeExists(c.entity.type)) {
          addError(
            policyId,
            `Unknown entity type '${c.entity.type}' in principal constraint`,
            c.entity.span,
          );
        }
        break;
      case "is":
        if (!entityTypeExists(c.entityType)) {
          addError(
            policyId,
            `Unknown entity type '${c.entityType}' in principal 'is' constraint`,
          );
        }
        break;
      case "is_in":
        if (!entityTypeExists(c.entityType)) {
          addError(
            policyId,
            `Unknown entity type '${c.entityType}' in principal 'is in' constraint`,
          );
        }
        if (!entityTypeExists(c.entity.type)) {
          addError(
            policyId,
            `Unknown entity type '${c.entity.type}' in principal 'is in' constraint`,
            c.entity.span,
          );
        }
        break;
    }
  }

  function validateAction(c: ActionConstraint, policyId: string): void {
    switch (c.kind) {
      case "eq":
      case "in": {
        const actionId = c.entity.id;
        if (!(actionId in schema.actions)) {
          addError(
            policyId,
            `Unknown action '${actionId}' in action constraint`,
            c.entity.span,
          );
        }
        break;
      }
      case "in_set":
        for (const e of c.entities) {
          if (!(e.id in schema.actions)) {
            addError(
              policyId,
              `Unknown action '${e.id}' in action set constraint`,
              e.span,
            );
          }
        }
        break;
    }
  }

  function validateResource(
    c: ResourceConstraint,
    policyId: string,
  ): void {
    switch (c.kind) {
      case "eq":
      case "in":
        if (!entityTypeExists(c.entity.type)) {
          addError(
            policyId,
            `Unknown entity type '${c.entity.type}' in resource constraint`,
            c.entity.span,
          );
        }
        break;
      case "is":
        if (!entityTypeExists(c.entityType)) {
          addError(
            policyId,
            `Unknown entity type '${c.entityType}' in resource 'is' constraint`,
          );
        }
        break;
      case "is_in":
        if (!entityTypeExists(c.entityType)) {
          addError(
            policyId,
            `Unknown entity type '${c.entityType}' in resource 'is in' constraint`,
          );
        }
        if (!entityTypeExists(c.entity.type)) {
          addError(
            policyId,
            `Unknown entity type '${c.entity.type}' in resource 'is in' constraint`,
            c.entity.span,
          );
        }
        break;
    }
  }

  // ── Validate expressions ───────────────────────────────────────────

  function inferType(expr: Expr, policyId: string): InferredType {
    switch (expr.kind) {
      case "literal":
        if (typeof expr.value === "boolean") return "Boolean";
        if (typeof expr.value === "number") return "Long";
        if (typeof expr.value === "string") return "String";
        return "Any";

      case "entity_uid": {
        if (!entityTypeExists(expr.type)) {
          addError(
            policyId,
            `Unknown entity type '${expr.type}'`,
            expr.span,
          );
        }
        return "Entity";
      }

      case "var":
        if (expr.name === "context") return "Record";
        return "Entity";

      case "not": {
        const t = inferType(expr.operand, policyId);
        if (t !== "Boolean" && t !== "Any") {
          addError(policyId, "'!' requires a boolean operand", expr.span);
        }
        return "Boolean";
      }

      case "neg": {
        const t = inferType(expr.operand, policyId);
        if (t !== "Long" && t !== "Any") {
          addError(policyId, "Negation requires a numeric operand", expr.span);
        }
        return "Long";
      }

      case "binary": {
        const lt = inferType(expr.left, policyId);
        const rt = inferType(expr.right, policyId);

        switch (expr.op) {
          case "&&":
          case "||":
            if (lt !== "Boolean" && lt !== "Any") {
              addError(policyId, `'${expr.op}' requires boolean operands`, expr.span);
            }
            if (rt !== "Boolean" && rt !== "Any") {
              addError(policyId, `'${expr.op}' requires boolean operands`, expr.span);
            }
            return "Boolean";

          case "+":
          case "-":
          case "*":
            if (lt !== "Long" && lt !== "Any") {
              addError(policyId, `'${expr.op}' requires numeric operands`, expr.span);
            }
            if (rt !== "Long" && rt !== "Any") {
              addError(policyId, `'${expr.op}' requires numeric operands`, expr.span);
            }
            return "Long";

          case "<":
          case "<=":
          case ">":
          case ">=":
            if (lt !== "Long" && lt !== "Any") {
              addError(policyId, `'${expr.op}' requires numeric operands`, expr.span);
            }
            if (rt !== "Long" && rt !== "Any") {
              addError(policyId, `'${expr.op}' requires numeric operands`, expr.span);
            }
            return "Boolean";

          case "==":
          case "!=":
            return "Boolean";
        }
        return "Any";
      }

      case "if_then_else": {
        const ct = inferType(expr.cond, policyId);
        if (ct !== "Boolean" && ct !== "Any") {
          addError(policyId, "'if' condition must be boolean", expr.span);
        }
        inferType(expr.then, policyId);
        inferType(expr.else_, policyId);
        return "Any";
      }

      case "in": {
        inferType(expr.left, policyId);
        inferType(expr.right, policyId);
        return "Boolean";
      }

      case "has": {
        inferType(expr.left, policyId);
        return "Boolean";
      }

      case "like": {
        const lt = inferType(expr.left, policyId);
        if (lt !== "String" && lt !== "Any") {
          addError(policyId, "'like' requires a string operand", expr.span);
        }
        return "Boolean";
      }

      case "is": {
        inferType(expr.left, policyId);
        if (!entityTypeExists(expr.entityType)) {
          addError(
            policyId,
            `Unknown entity type '${expr.entityType}' in 'is' expression`,
            expr.span,
          );
        }
        if (expr.inExpr) inferType(expr.inExpr, policyId);
        return "Boolean";
      }

      case "get_attr": {
        const _leftType = inferType(expr.left, policyId);

        // If the left is a known entity variable, try to validate the attribute
        if (expr.left.kind === "var" && expr.left.name !== "context") {
          // We could resolve the entity type from scope but that's complex;
          // for now just accept attribute accesses on entities
        } else if (expr.left.kind === "var" && expr.left.name === "context") {
          // Context attribute access — hard to validate without action context type
        } else if (expr.left.kind === "entity_uid") {
          const shape = getEntityShape(expr.left.type);
          if (shape && !(expr.attr in shape.attributes)) {
            addError(
              policyId,
              `Attribute '${expr.attr}' does not exist on entity type '${expr.left.type}'`,
              expr.span,
            );
          }
        }
        return "Any";
      }

      case "method_call": {
        const lt = inferType(expr.left, policyId);
        for (const arg of expr.args) {
          inferType(arg, policyId);
        }

        if (
          (expr.method === "contains" ||
            expr.method === "containsAll" ||
            expr.method === "containsAny") &&
          lt !== "Set" &&
          lt !== "Any"
        ) {
          addError(
            policyId,
            `'${expr.method}' requires a set operand`,
            expr.span,
          );
        }
        return "Boolean";
      }

      case "set":
        for (const el of expr.elements) inferType(el, policyId);
        return "Set";

      case "record":
        for (const p of expr.pairs) inferType(p.value, policyId);
        return "Record";

      case "slot":
        return "Any";
    }
  }

  // ── Main validation loop ───────────────────────────────────────────

  for (const policy of policies) {
    validatePrincipal(policy.principal, policy.id);
    validateAction(policy.action, policy.id);
    validateResource(policy.resource, policy.id);

    for (const cond of policy.conditions) {
      const t = inferType(cond.body, policy.id);
      if (t !== "Boolean" && t !== "Any") {
        addError(
          policy.id,
          `Condition body must be boolean, inferred type '${t}'`,
          cond.span,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
