// ── Cedar AST Node Types ─────────────────────────────────────────────

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Span {
  start: Position;
  end: Position;
}

// ── Top-level structures ─────────────────────────────────────────────

export type Effect = "permit" | "forbid";

export interface PolicySet {
  policies: Policy[];
}

export interface Policy {
  id: string;
  effect: Effect;
  principal: PrincipalConstraint;
  action: ActionConstraint;
  resource: ResourceConstraint;
  conditions: Condition[];
  span: Span;
}

export interface Condition {
  kind: "when" | "unless";
  body: Expr;
  span: Span;
}

// ── Scope constraints ────────────────────────────────────────────────

export type PrincipalConstraint =
  | { kind: "any" }
  | { kind: "eq"; entity: EntityUIDLiteral }
  | { kind: "in"; entity: EntityUIDLiteral }
  | { kind: "is"; entityType: string }
  | { kind: "is_in"; entityType: string; entity: EntityUIDLiteral };

export type ActionConstraint =
  | { kind: "any" }
  | { kind: "eq"; entity: EntityUIDLiteral }
  | { kind: "in"; entity: EntityUIDLiteral }
  | { kind: "in_set"; entities: EntityUIDLiteral[] };

export type ResourceConstraint =
  | { kind: "any" }
  | { kind: "eq"; entity: EntityUIDLiteral }
  | { kind: "in"; entity: EntityUIDLiteral }
  | { kind: "is"; entityType: string }
  | { kind: "is_in"; entityType: string; entity: EntityUIDLiteral };

export interface EntityUIDLiteral {
  type: string;
  id: string;
  span: Span;
}

// ── Expressions ──────────────────────────────────────────────────────

export type Expr =
  | LiteralExpr
  | EntityUIDExpr
  | VarExpr
  | SlotExpr
  | NotExpr
  | NegExpr
  | BinaryExpr
  | IfThenElseExpr
  | InExpr
  | HasExpr
  | LikeExpr
  | IsExpr
  | GetAttrExpr
  | MethodCallExpr
  | SetExpr
  | RecordExpr;

export interface LiteralExpr {
  kind: "literal";
  value: boolean | number | string;
  span: Span;
}

export interface EntityUIDExpr {
  kind: "entity_uid";
  type: string;
  id: string;
  span: Span;
}

export interface VarExpr {
  kind: "var";
  name: "principal" | "action" | "resource" | "context";
  span: Span;
}

export interface SlotExpr {
  kind: "slot";
  name: string;
  span: Span;
}

export interface NotExpr {
  kind: "not";
  operand: Expr;
  span: Span;
}

export interface NegExpr {
  kind: "neg";
  operand: Expr;
  span: Span;
}

export type BinaryOp =
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||"
  | "+" | "-" | "*";

export interface BinaryExpr {
  kind: "binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface IfThenElseExpr {
  kind: "if_then_else";
  cond: Expr;
  then: Expr;
  else_: Expr;
  span: Span;
}

export interface InExpr {
  kind: "in";
  left: Expr;
  right: Expr;
  span: Span;
}

export interface HasExpr {
  kind: "has";
  left: Expr;
  attr: string;
  span: Span;
}

export interface LikeExpr {
  kind: "like";
  left: Expr;
  pattern: string;
  span: Span;
}

export interface IsExpr {
  kind: "is";
  left: Expr;
  entityType: string;
  inExpr?: Expr;
  span: Span;
}

export interface GetAttrExpr {
  kind: "get_attr";
  left: Expr;
  attr: string;
  span: Span;
}

export interface MethodCallExpr {
  kind: "method_call";
  left: Expr;
  method: string;
  args: Expr[];
  span: Span;
}

export interface SetExpr {
  kind: "set";
  elements: Expr[];
  span: Span;
}

export interface RecordExpr {
  kind: "record";
  pairs: { key: string; value: Expr }[];
  span: Span;
}
