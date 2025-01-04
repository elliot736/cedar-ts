// ── Cedar Tokenizer ──────────────────────────────────────────────────

import type { Position } from "./ast.js";

export enum TokenKind {
  // Keywords
  Permit = "permit",
  Forbid = "forbid",
  When = "when",
  Unless = "unless",
  If = "if",
  Then = "then",
  Else = "else",
  True = "true",
  False = "false",
  In = "in",
  Has = "has",
  Like = "like",
  Is = "is",
  Principal = "principal",
  Action = "action",
  Resource = "resource",
  Context = "context",

  // Literals
  Long = "LONG",
  String = "STRING",
  Ident = "IDENT",

  // Operators
  Eq = "==",
  Neq = "!=",
  Lt = "<",
  Gt = ">",
  Lte = "<=",
  Gte = ">=",
  And = "&&",
  Or = "||",
  Not = "!",
  Plus = "+",
  Minus = "-",
  Star = "*",
  Dot = ".",

  // Delimiters
  LParen = "(",
  RParen = ")",
  LBrace = "{",
  RBrace = "}",
  LBracket = "[",
  RBracket = "]",
  Semicolon = ";",
  Comma = ",",
  ColonColon = "::",
  Colon = ":",
  At = "@",

  // Special
  EOF = "EOF",
}

export interface Token {
  kind: TokenKind;
  value: string;
  pos: Position;
}

const KEYWORDS: Record<string, TokenKind> = {
  permit: TokenKind.Permit,
  forbid: TokenKind.Forbid,
  when: TokenKind.When,
  unless: TokenKind.Unless,
  if: TokenKind.If,
  then: TokenKind.Then,
  else: TokenKind.Else,
  true: TokenKind.True,
  false: TokenKind.False,
  in: TokenKind.In,
  has: TokenKind.Has,
  like: TokenKind.Like,
  is: TokenKind.Is,
  principal: TokenKind.Principal,
  action: TokenKind.Action,
  resource: TokenKind.Resource,
  context: TokenKind.Context,
};

export class TokenizerError extends Error {
  constructor(
    message: string,
    public pos: Position,
  ) {
    super(`${message} at line ${pos.line}, column ${pos.column}`);
    this.name = "TokenizerError";
  }
}

export class Tokenizer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];
  private current: number = 0;

  constructor(source: string) {
    this.source = source;
    this.tokenize();
  }

  private position(): Position {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private peek(): string {
    return this.source[this.pos] ?? "\0";
  }

  private peekAt(offset: number): string {
    return this.source[this.pos + offset] ?? "\0";
  }

  private advance(): string {
    const ch = this.source[this.pos] ?? "\0";
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
      } else if (ch === "/" && this.peekAt(1) === "/") {
        // Line comment
        while (this.pos < this.source.length && this.peek() !== "\n") {
          this.advance();
        }
      } else if (ch === "/" && this.peekAt(1) === "*") {
        // Block comment
        this.advance(); // /
        this.advance(); // *
        while (this.pos < this.source.length) {
          if (this.peek() === "*" && this.peekAt(1) === "/") {
            this.advance(); // *
            this.advance(); // /
            break;
          }
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private readString(): string {
    const quote = this.advance(); // consume opening "
    let result = "";
    while (this.pos < this.source.length) {
      const ch = this.advance();
      if (ch === quote) {
        return result;
      }
      if (ch === "\\") {
        const esc = this.advance();
        switch (esc) {
          case "n": result += "\n"; break;
          case "t": result += "\t"; break;
          case "r": result += "\r"; break;
          case "\\": result += "\\"; break;
          case "\"": result += "\""; break;
          case "'": result += "'"; break;
          case "0": result += "\0"; break;
          case "*": result += "\\*"; break;
          default:
            result += esc;
        }
      } else {
        result += ch;
      }
    }
    throw new TokenizerError("Unterminated string literal", this.position());
  }

  private readNumber(): string {
    let result = "";
    while (this.pos < this.source.length && /[0-9]/.test(this.peek())) {
      result += this.advance();
    }
    return result;
  }

  private readIdentifier(): string {
    let result = "";
    while (
      this.pos < this.source.length &&
      /[a-zA-Z0-9_]/.test(this.peek())
    ) {
      result += this.advance();
    }
    return result;
  }

  private tokenize(): void {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;

      const start = this.position();
      const ch = this.peek();

      // String literals
      if (ch === '"') {
        const value = this.readString();
        this.tokens.push({ kind: TokenKind.String, value, pos: start });
        continue;
      }

      // Number literals
      if (/[0-9]/.test(ch)) {
        const value = this.readNumber();
        this.tokens.push({ kind: TokenKind.Long, value, pos: start });
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(ch)) {
        const value = this.readIdentifier();
        const keyword = KEYWORDS[value];
        if (keyword) {
          this.tokens.push({ kind: keyword, value, pos: start });
        } else {
          this.tokens.push({ kind: TokenKind.Ident, value, pos: start });
        }
        continue;
      }

      // Two-character operators
      const two = ch + this.peekAt(1);
      switch (two) {
        case "==": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.Eq, value: "==", pos: start }); continue;
        case "!=": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.Neq, value: "!=", pos: start }); continue;
        case "<=": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.Lte, value: "<=", pos: start }); continue;
        case ">=": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.Gte, value: ">=", pos: start }); continue;
        case "&&": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.And, value: "&&", pos: start }); continue;
        case "||": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.Or, value: "||", pos: start }); continue;
        case "::": this.advance(); this.advance(); this.tokens.push({ kind: TokenKind.ColonColon, value: "::", pos: start }); continue;
      }

      // Single-character tokens
      this.advance();
      switch (ch) {
        case "(": this.tokens.push({ kind: TokenKind.LParen, value: "(", pos: start }); break;
        case ")": this.tokens.push({ kind: TokenKind.RParen, value: ")", pos: start }); break;
        case "{": this.tokens.push({ kind: TokenKind.LBrace, value: "{", pos: start }); break;
        case "}": this.tokens.push({ kind: TokenKind.RBrace, value: "}", pos: start }); break;
        case "[": this.tokens.push({ kind: TokenKind.LBracket, value: "[", pos: start }); break;
        case "]": this.tokens.push({ kind: TokenKind.RBracket, value: "]", pos: start }); break;
        case ";": this.tokens.push({ kind: TokenKind.Semicolon, value: ";", pos: start }); break;
        case ",": this.tokens.push({ kind: TokenKind.Comma, value: ",", pos: start }); break;
        case ".": this.tokens.push({ kind: TokenKind.Dot, value: ".", pos: start }); break;
        case "+": this.tokens.push({ kind: TokenKind.Plus, value: "+", pos: start }); break;
        case "-": this.tokens.push({ kind: TokenKind.Minus, value: "-", pos: start }); break;
        case "*": this.tokens.push({ kind: TokenKind.Star, value: "*", pos: start }); break;
        case "<": this.tokens.push({ kind: TokenKind.Lt, value: "<", pos: start }); break;
        case ">": this.tokens.push({ kind: TokenKind.Gt, value: ">", pos: start }); break;
        case "!": this.tokens.push({ kind: TokenKind.Not, value: "!", pos: start }); break;
        case ":": this.tokens.push({ kind: TokenKind.Colon, value: ":", pos: start }); break;
        case "@": this.tokens.push({ kind: TokenKind.At, value: "@", pos: start }); break;
        default:
          throw new TokenizerError(`Unexpected character '${ch}'`, start);
      }
    }

    this.tokens.push({
      kind: TokenKind.EOF,
      value: "",
      pos: this.position(),
    });
  }

  // ── Public API for the parser ────────────────────────────────────────

  peekToken(): Token {
    return this.tokens[this.current]!;
  }

  peekTokenAt(offset: number): Token {
    const idx = this.current + offset;
    return this.tokens[Math.min(idx, this.tokens.length - 1)]!;
  }

  nextToken(): Token {
    const tok = this.tokens[this.current]!;
    if (this.current < this.tokens.length - 1) {
      this.current++;
    }
    return tok;
  }

  expect(kind: TokenKind): Token {
    const tok = this.nextToken();
    if (tok.kind !== kind) {
      throw new TokenizerError(
        `Expected '${kind}' but got '${tok.kind}' ("${tok.value}")`,
        tok.pos,
      );
    }
    return tok;
  }

  isAtEnd(): boolean {
    return this.peekToken().kind === TokenKind.EOF;
  }
}
