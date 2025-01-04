/**
 * cedar-ts — A pure TypeScript implementation of the AWS Cedar policy language.
 *
 * Provides parsing, evaluation, entity management, schema validation,
 * and a high-level Authorizer API with zero dependencies.
 *
 * @packageDocumentation
 */

// ── cedar-ts Public API ──────────────────────────────────────────────

// Parser
export { parsePolicies, parseExpression, ParseError } from "./parser/parser.js";
export type {
  Policy,
  PolicySet,
  Effect,
  Expr,
  Condition,
  PrincipalConstraint,
  ActionConstraint,
  ResourceConstraint,
  EntityUIDLiteral,
  Span,
  Position,
} from "./parser/ast.js";

// Values
export {
  CedarSet,
  entityUIDToString,
  entityUIDEquals,
  entityUIDKey,
  cedarValueEquals,
  isEntityUID,
  isCedarSet,
  isCedarRecord,
  isCedarExtension,
} from "./evaluator/values.js";
export type {
  CedarValue,
  EntityUID,
  CedarRecord,
  CedarExtension,
} from "./evaluator/values.js";

// Request context
export type { Request } from "./evaluator/context.js";

// Evaluator
export {
  evaluate,
  evalExpr,
  EvaluationError,
} from "./evaluator/evaluator.js";
export type {
  Decision,
  Diagnostics,
  AuthorizationResponse,
} from "./evaluator/evaluator.js";

// Entities
export type { Entity } from "./entities/types.js";
export type { EntityStore } from "./entities/store.js";
export { MemoryEntityStore } from "./entities/memory.js";

// Schema
export type {
  CedarSchema,
  EntityTypeSchema,
  ActionSchema,
  TypeSchema,
  PrimitiveTypeSchema,
  SetTypeSchema,
  RecordTypeSchema,
  EntityRefTypeSchema,
  AttributeSchema,
} from "./schema/schema.js";
export { validatePolicies } from "./schema/validator.js";
export type { ValidationError, ValidationResult } from "./schema/validator.js";

// Authorizer
export { Authorizer } from "./authorizer.js";
