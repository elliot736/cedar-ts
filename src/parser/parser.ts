// ── Cedar Recursive Descent Parser ───────────────────────────────────

import { Tokenizer, TokenKind } from "./tokenizer.js";
import type { Token } from "./tokenizer.js";
import type {
  Policy,
  PolicySet,
  Effect,
  PrincipalConstraint,
  ActionConstraint,
  ResourceConstraint,
  Condition,
  EntityUIDLiteral,
  Expr,
  BinaryOp,
  Span,
  Position,
} from "./ast.js";

/**
 * Error thrown when Cedar policy text cannot be parsed.
 * Includes the line and column where the error occurred.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public pos: Position,
  ) {
    super(`Parse error at line ${pos.line}, column ${pos.column}: ${message}`);
    this.name = "ParseError";
  }
}

/**
 * Parse Cedar policy text into a set of AST policy nodes.
 *
 * @param source - Cedar policy text (one or more policies)
 * @returns A PolicySet containing all parsed policies
 * @throws {ParseError} If the source text is not valid Cedar syntax
 */
export function parsePolicies(source: string): PolicySet {
  const parser = new Parser(source);
  return parser.parsePolicySet();
}

/**
 * Parse a standalone Cedar expression (e.g., for use in tooling or editors).
 *
 * @param source - A single Cedar expression string
 * @returns The parsed expression AST node
 * @throws {ParseError} If the source is not a valid Cedar expression
 */
export function parseExpression(source: string): Expr {
  const parser = new Parser(source);
  return parser.parseExpr();
}

class Parser {
  private tok: Tokenizer;
  private policyCounter = 0;

  constructor(source: string) {
    this.tok = new Tokenizer(source);
  }

  private error(msg: string, token?: Token): never {
    const t = token ?? this.tok.peekToken();
    throw new ParseError(msg, t.pos);
  }

  private span(start: Position): Span {
    const prev = this.tok.peekToken();
    return { start, end: prev.pos };
  }

  // ── Policy set ───────────────────────────────────────────────────────

  parsePolicySet(): PolicySet {
    const policies: Policy[] = [];
    // Skip annotations
    while (!this.tok.isAtEnd()) {
      this.skipAnnotations();
      if (this.tok.isAtEnd()) break;
      policies.push(this.parsePolicy());
    }
    return { policies };
  }

  private skipAnnotations(): void {
    while (this.tok.peekToken().kind === TokenKind.At) {
      this.tok.nextToken(); // @
      this.tok.expect(TokenKind.Ident); // annotation name
      this.tok.expect(TokenKind.LParen);
      this.tok.expect(TokenKind.String);
      this.tok.expect(TokenKind.RParen);
    }
  }

  // ── Single policy ────────────────────────────────────────────────────

  private parsePolicy(): Policy {
    const start = this.tok.peekToken().pos;
    const effect = this.parseEffect();
    this.tok.expect(TokenKind.LParen);
    const principal = this.parsePrincipalConstraint();
    this.tok.expect(TokenKind.Comma);
    const action = this.parseActionConstraint();
    this.tok.expect(TokenKind.Comma);
    const resource = this.parseResourceConstraint();
    this.tok.expect(TokenKind.RParen);

    const conditions: Condition[] = [];
    while (
      this.tok.peekToken().kind === TokenKind.When ||
      this.tok.peekToken().kind === TokenKind.Unless
    ) {
      conditions.push(this.parseCondition());
    }

    this.tok.expect(TokenKind.Semicolon);

    const id = `policy${this.policyCounter++}`;
    return {
      id,
      effect,
      principal,
      action,
      resource,
      conditions,
      span: this.span(start),
    };
  }

  private parseEffect(): Effect {
    const tok = this.tok.nextToken();
    if (tok.kind === TokenKind.Permit) return "permit";
    if (tok.kind === TokenKind.Forbid) return "forbid";
    this.error("Expected 'permit' or 'forbid'", tok);
  }

  // ── Scope constraints ────────────────────────────────────────────────

  private parsePrincipalConstraint(): PrincipalConstraint {
    this.tok.expect(TokenKind.Principal);
    return this.parseScopeConstraint() as PrincipalConstraint;
  }

  private parseActionConstraint(): ActionConstraint {
    this.tok.expect(TokenKind.Action);
    const peek = this.tok.peekToken();

    if (peek.kind === TokenKind.Eq) {
      this.tok.nextToken();
      const entity = this.parseEntityUID();
      return { kind: "eq", entity };
    }

    if (peek.kind === TokenKind.In) {
      this.tok.nextToken();
      // Could be `in [set]` or `in entity`
      if (this.tok.peekToken().kind === TokenKind.LBracket) {
        this.tok.nextToken(); // [
        const entities: EntityUIDLiteral[] = [];
        while (this.tok.peekToken().kind !== TokenKind.RBracket) {
          if (entities.length > 0) {
            this.tok.expect(TokenKind.Comma);
          }
          entities.push(this.parseEntityUID());
        }
        this.tok.expect(TokenKind.RBracket);
        return { kind: "in_set", entities };
      }
      const entity = this.parseEntityUID();
      return { kind: "in", entity };
    }

    return { kind: "any" };
  }

  private parseResourceConstraint(): ResourceConstraint {
    this.tok.expect(TokenKind.Resource);
    return this.parseScopeConstraint() as ResourceConstraint;
  }

  private parseScopeConstraint(): PrincipalConstraint | ResourceConstraint {
    const peek = this.tok.peekToken();

    if (peek.kind === TokenKind.Eq) {
      this.tok.nextToken();
      const entity = this.parseEntityUID();
      return { kind: "eq", entity };
    }

    if (peek.kind === TokenKind.In) {
      this.tok.nextToken();
      const entity = this.parseEntityUID();
      return { kind: "in", entity };
    }

    if (peek.kind === TokenKind.Is) {
      this.tok.nextToken();
      const entityType = this.parseEntityType();
      if (this.tok.peekToken().kind === TokenKind.In) {
        this.tok.nextToken();
        const entity = this.parseEntityUID();
        return { kind: "is_in", entityType, entity };
      }
      return { kind: "is", entityType };
    }

    return { kind: "any" };
  }

  private parseEntityUID(): EntityUIDLiteral {
    const start = this.tok.peekToken().pos;
    const type = this.parseEntityType();
    this.tok.expect(TokenKind.ColonColon);
    const idTok = this.tok.expect(TokenKind.String);
    return { type, id: idTok.value, span: this.span(start) };
  }

  private parseEntityType(): string {
    let name = this.tok.nextToken().value;
    // Entity types can be namespaced: A::B::C  (but not followed by a string)
    while (
      this.tok.peekToken().kind === TokenKind.ColonColon &&
      this.tok.peekTokenAt(1).kind === TokenKind.Ident
    ) {
      this.tok.nextToken(); // ::
      name += "::" + this.tok.nextToken().value;
    }
    return name;
  }

  // ── Conditions ─────────────────────────────────────────────────────

  private parseCondition(): Condition {
    const start = this.tok.peekToken().pos;
    const kindTok = this.tok.nextToken();
    const kind = kindTok.kind === TokenKind.When ? "when" : "unless";
    this.tok.expect(TokenKind.LBrace);
    const body = this.parseExpr();
    this.tok.expect(TokenKind.RBrace);
    return { kind, body, span: this.span(start) };
  }

  // ── Expression parsing (Pratt-style precedence) ────────────────────

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.tok.peekToken().kind === TokenKind.Or) {
      const start = left.span.start;
      this.tok.nextToken();
      const right = this.parseAnd();
      left = { kind: "binary", op: "||", left, right, span: this.span(start) };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseRelation();
    while (this.tok.peekToken().kind === TokenKind.And) {
      const start = left.span.start;
      this.tok.nextToken();
      const right = this.parseRelation();
      left = { kind: "binary", op: "&&", left, right, span: this.span(start) };
    }
    return left;
  }

  private parseRelation(): Expr {
    let left = this.parseHasIn();

    const peek = this.tok.peekToken().kind;
    const relOps: Partial<Record<TokenKind, BinaryOp>> = {
      [TokenKind.Eq]: "==",
      [TokenKind.Neq]: "!=",
      [TokenKind.Lt]: "<",
      [TokenKind.Gt]: ">",
      [TokenKind.Lte]: "<=",
      [TokenKind.Gte]: ">=",
    };

    const op = relOps[peek];
    if (op) {
      const start = left.span.start;
      this.tok.nextToken();
      const right = this.parseHasIn();
      left = { kind: "binary", op, left, right, span: this.span(start) };
    }

    return left;
  }

  private parseHasIn(): Expr {
    let left = this.parseAddSub();

    while (true) {
      const peek = this.tok.peekToken();

      if (peek.kind === TokenKind.Has) {
        const start = left.span.start;
        this.tok.nextToken();
        // `has` can be followed by an identifier or a string literal
        let attr: string;
        if (this.tok.peekToken().kind === TokenKind.String) {
          attr = this.tok.nextToken().value;
        } else {
          attr = this.tok.nextToken().value;
        }
        left = { kind: "has", left, attr, span: this.span(start) };
        continue;
      }

      if (peek.kind === TokenKind.In) {
        const start = left.span.start;
        this.tok.nextToken();
        const right = this.parseAddSub();
        left = { kind: "in", left, right, span: this.span(start) };
        continue;
      }

      if (peek.kind === TokenKind.Like) {
        const start = left.span.start;
        this.tok.nextToken();
        const patternTok = this.tok.expect(TokenKind.String);
        left = { kind: "like", left, pattern: patternTok.value, span: this.span(start) };
        continue;
      }

      if (peek.kind === TokenKind.Is) {
        const start = left.span.start;
        this.tok.nextToken();
        const entityType = this.parseEntityType();
        let inExpr: Expr | undefined;
        if (this.tok.peekToken().kind === TokenKind.In) {
          this.tok.nextToken();
          inExpr = this.parseAddSub();
        }
        left = { kind: "is", left, entityType, inExpr, span: this.span(start) };
        continue;
      }

      break;
    }

    return left;
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (
      this.tok.peekToken().kind === TokenKind.Plus ||
      this.tok.peekToken().kind === TokenKind.Minus
    ) {
      const start = left.span.start;
      const op: BinaryOp = this.tok.nextToken().kind === TokenKind.Plus ? "+" : "-";
      const right = this.parseMulDiv();
      left = { kind: "binary", op, left, right, span: this.span(start) };
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parseUnary();
    while (this.tok.peekToken().kind === TokenKind.Star) {
      const start = left.span.start;
      this.tok.nextToken();
      const right = this.parseUnary();
      left = { kind: "binary", op: "*", left, right, span: this.span(start) };
    }
    return left;
  }

  private parseUnary(): Expr {
    const peek = this.tok.peekToken();

    if (peek.kind === TokenKind.Not) {
      const start = peek.pos;
      this.tok.nextToken();
      const operand = this.parseUnary();
      return { kind: "not", operand, span: this.span(start) };
    }

    if (peek.kind === TokenKind.Minus) {
      const start = peek.pos;
      this.tok.nextToken();
      const operand = this.parseUnary();
      return { kind: "neg", operand, span: this.span(start) };
    }

    if (peek.kind === TokenKind.If) {
      return this.parseIfThenElse();
    }

    return this.parseAccess();
  }

  private parseIfThenElse(): Expr {
    const start = this.tok.peekToken().pos;
    this.tok.expect(TokenKind.If);
    const cond = this.parseExpr();
    this.tok.expect(TokenKind.Then);
    const then = this.parseExpr();
    this.tok.expect(TokenKind.Else);
    const else_ = this.parseExpr();
    return { kind: "if_then_else", cond, then, else_, span: this.span(start) };
  }

  // ── Member access / method calls ─────────────────────────────────

  private parseAccess(): Expr {
    let left = this.parsePrimary();

    while (this.tok.peekToken().kind === TokenKind.Dot) {
      const start = left.span.start;
      this.tok.nextToken(); // .
      const ident = this.tok.nextToken();

      // Method call?
      if (this.tok.peekToken().kind === TokenKind.LParen) {
        this.tok.nextToken(); // (
        const args: Expr[] = [];
        while (this.tok.peekToken().kind !== TokenKind.RParen) {
          if (args.length > 0) this.tok.expect(TokenKind.Comma);
          args.push(this.parseExpr());
        }
        this.tok.expect(TokenKind.RParen);
        left = {
          kind: "method_call",
          left,
          method: ident.value,
          args,
          span: this.span(start),
        };
      } else {
        // Attribute access
        left = {
          kind: "get_attr",
          left,
          attr: ident.value,
          span: this.span(start),
        };
      }
    }

    // Also support `left["key"]` syntax
    while (this.tok.peekToken().kind === TokenKind.LBracket) {
      const start = left.span.start;
      this.tok.nextToken(); // [
      const keyTok = this.tok.expect(TokenKind.String);
      this.tok.expect(TokenKind.RBracket);
      left = {
        kind: "get_attr",
        left,
        attr: keyTok.value,
        span: this.span(start),
      };
    }

    return left;
  }

  // ── Primaries ────────────────────────────────────────────────────

  private parsePrimary(): Expr {
    const tok = this.tok.peekToken();

    switch (tok.kind) {
      case TokenKind.True:
        this.tok.nextToken();
        return { kind: "literal", value: true, span: this.span(tok.pos) };

      case TokenKind.False:
        this.tok.nextToken();
        return { kind: "literal", value: false, span: this.span(tok.pos) };

      case TokenKind.Long: {
        this.tok.nextToken();
        return {
          kind: "literal",
          value: parseInt(tok.value, 10),
          span: this.span(tok.pos),
        };
      }

      case TokenKind.String: {
        this.tok.nextToken();
        return { kind: "literal", value: tok.value, span: this.span(tok.pos) };
      }

      case TokenKind.Principal:
      case TokenKind.Action:
      case TokenKind.Resource:
      case TokenKind.Context: {
        this.tok.nextToken();
        return {
          kind: "var",
          name: tok.value as "principal" | "action" | "resource" | "context",
          span: this.span(tok.pos),
        };
      }

      case TokenKind.Ident: {
        // Could be an entity UID: Type::"id"
        if (
          this.tok.peekTokenAt(1).kind === TokenKind.ColonColon
        ) {
          const uid = this.parseEntityUID();
          return {
            kind: "entity_uid",
            type: uid.type,
            id: uid.id,
            span: uid.span,
          };
        }
        this.tok.nextToken();
        return { kind: "literal", value: tok.value, span: this.span(tok.pos) };
      }

      case TokenKind.LParen: {
        this.tok.nextToken();
        const expr = this.parseExpr();
        this.tok.expect(TokenKind.RParen);
        return expr;
      }

      case TokenKind.LBracket: {
        return this.parseSetLiteral();
      }

      case TokenKind.LBrace: {
        return this.parseRecordLiteral();
      }

      default:
        this.error(`Unexpected token '${tok.value}' (${tok.kind})`);
    }
  }

  private parseSetLiteral(): Expr {
    const start = this.tok.peekToken().pos;
    this.tok.expect(TokenKind.LBracket);
    const elements: Expr[] = [];
    while (this.tok.peekToken().kind !== TokenKind.RBracket) {
      if (elements.length > 0) this.tok.expect(TokenKind.Comma);
      elements.push(this.parseExpr());
    }
    this.tok.expect(TokenKind.RBracket);
    return { kind: "set", elements, span: this.span(start) };
  }

  private parseRecordLiteral(): Expr {
    const start = this.tok.peekToken().pos;
    this.tok.expect(TokenKind.LBrace);
    const pairs: { key: string; value: Expr }[] = [];
    while (this.tok.peekToken().kind !== TokenKind.RBrace) {
      if (pairs.length > 0) this.tok.expect(TokenKind.Comma);
      // Key can be string or ident
      let key: string;
      if (this.tok.peekToken().kind === TokenKind.String) {
        key = this.tok.nextToken().value;
      } else {
        key = this.tok.nextToken().value;
      }
      this.tok.expect(TokenKind.Colon);
      const value = this.parseExpr();
      pairs.push({ key, value });
    }
    this.tok.expect(TokenKind.RBrace);
    return { kind: "record", pairs, span: this.span(start) };
  }
}
