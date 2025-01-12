# ADR-002: Parser Design — Recursive Descent

## Status

Accepted

## Context

The Cedar policy language has a well-defined grammar documented in the Cedar specification. To parse Cedar policy text into an AST, we need a parsing strategy. The main options considered were:

1. **PEG parser generator** (e.g., pegjs/peggy): Define the grammar in a PEG DSL, generate a parser at build time. Pros: grammar is declarative and closely mirrors the spec. Cons: adds a build step, generated code is hard to debug, error messages require significant customization effort, and the generated parser becomes a runtime dependency.

2. **Parser combinator library** (e.g., parsimmon, chevrotain): Compose small parsing functions into a larger parser. Pros: compositional, no code generation. Cons: adds a runtime dependency, performance overhead from closure allocation and backtracking, error messages are often poor by default.

3. **Hand-written recursive descent parser**: Implement the parser directly in TypeScript as a set of mutually recursive functions, one per grammar production. Pros: zero dependencies, full control over error messages, straightforward debugging, excellent performance. Cons: more code to write and maintain, grammar changes require manual parser updates.

Cedar's grammar has several properties that make recursive descent particularly suitable:

- The grammar is LL(1) or LL(2) in almost all cases — a single token of lookahead is sufficient to decide which production to use.
- Operator precedence is fixed and can be encoded directly in the function call hierarchy (or/and/comparison/add/mul/unary/primary).
- The language has no ambiguous constructs that would require backtracking.
- Entity UIDs (`Type::"id"`) can be distinguished from identifiers with two tokens of lookahead (identifier followed by `::`).

## Decision

We use a hand-written recursive descent parser with a separate tokenizer (lexer) phase.

The parser is split into two phases:

1. **Tokenizer** (`tokenizer.ts`): Converts the raw source string into a flat array of tokens. Each token carries its kind, value, and source position (line, column, byte offset). The tokenizer handles whitespace skipping, line/block comments, string escape sequences, and keyword recognition.

2. **Parser** (`parser.ts`): Consumes the token array via a cursor, implementing one function per grammar production. Expression parsing uses a precedence-climbing approach encoded in the function call hierarchy: `parseOr -> parseAnd -> parseRelation -> parseHasIn -> parseAddSub -> parseMulDiv -> parseUnary -> parseAccess -> parsePrimary`.

## Consequences

### Positive

- **Zero runtime dependencies**: The parser is pure TypeScript with no external libraries.
- **Excellent error messages**: Because we control every parsing decision, we can produce errors like `Parse error at line 5, column 12: Expected '}' but got 'EOF'` with precise source positions. This is critical for developer experience in policy editors.
- **Debuggable**: A developer can set a breakpoint in `parsePolicy()` or `parseExpr()` and step through the parsing of any policy. The call stack directly reflects the grammar structure.
- **Performance**: No backtracking, no closure allocation per parse. The tokenizer makes a single pass, and the parser makes a single pass over the token array. Parsing a typical policy takes microseconds.
- **Incremental extension**: Adding a new keyword or operator means adding a token kind, adding a case in the relevant parse function, and adding an AST node type. The change is localized and mechanical.

### Negative

- **More code**: The parser is ~400 lines of hand-written code, compared to ~50 lines of PEG grammar. This is more surface area for bugs.
- **Grammar drift risk**: If the Cedar grammar changes, we must manually update the parser. There is no single source of truth that can be mechanically validated against the spec.
- **No formal verification**: Unlike a parser generated from a formal grammar, we cannot mechanically prove that our parser accepts exactly the Cedar language and nothing more.

### Structure

```
src/parser/
├── ast.ts        # AST node type definitions (pure types, no logic)
├── tokenizer.ts  # Lexer: source string -> Token[]
└── parser.ts     # Recursive descent parser: Token[] -> AST
```

The AST types are designed to be serializable (no circular references, no class instances) so they can be cached, serialized to JSON, or sent across worker boundaries.
