# ADR-001: Pure TypeScript Implementation

## Status

Accepted

## Context

AWS Cedar is an open-source policy language for authorization. The reference implementation is written in Rust, and official bindings exist as WASM packages that wrap the Rust core. While functional, these WASM bindings carry significant trade-offs for TypeScript/JavaScript consumers:

- **Bundle size**: The WASM binary adds 500KB+ to the bundle, which is unacceptable for edge runtimes (Cloudflare Workers, Vercel Edge Functions) with strict size limits.
- **Opacity**: WASM is a black box. When a policy evaluation fails or produces an unexpected result, developers cannot step through the logic in standard JS debuggers.
- **Initialization cost**: WASM modules require asynchronous instantiation, which complicates library initialization and creates footguns in synchronous codepaths.
- **Tree-shaking**: Bundlers cannot tree-shake WASM — you pay for the entire Cedar engine even if you only need the parser.
- **Runtime compatibility**: Not all JavaScript runtimes support WASM (some embedded runtimes, React Native's Hermes engine in older versions, restricted CSP environments).

Meanwhile, Cedar's grammar and evaluation semantics are well-documented in the Cedar language specification. The language is intentionally simple (no general recursion, no user-defined functions) which makes a correct reimplementation tractable.

## Decision

We implement Cedar's parser, evaluator, entity store, and schema validator entirely in TypeScript with zero native or WASM dependencies.

## Consequences

### Positive

- **Debuggable**: Developers can set breakpoints in policy evaluation, inspect AST nodes, and trace evaluation step by step using standard tooling.
- **Tree-shakeable**: A consumer who only needs the parser (e.g., for a policy editor) can import just the parser module. Dead code elimination works naturally.
- **Edge-runtime compatible**: The library runs anywhere JavaScript runs — Cloudflare Workers, Deno, Bun, Node.js, browsers — with no WASM instantiation step.
- **Zero dependencies**: No supply chain risk from transitive dependencies. The library is entirely self-contained.
- **Synchronous API**: No async initialization. `parsePolicies()` and `evaluate()` are plain synchronous function calls.
- **Small bundle**: The entire library compresses to under 20KB gzipped, compared to 500KB+ for the WASM approach.

### Negative

- **Specification tracking**: When the Cedar language evolves (new operators, changed semantics), we must manually update our implementation. There is no mechanical way to derive changes from the Rust codebase.
- **Correctness risk**: Without sharing code with the reference implementation, there is a risk of subtle semantic divergences. This must be mitigated with comprehensive tests, ideally including the Cedar conformance test suite.
- **Extension types**: Cedar's extension types (IP addresses, decimals) require implementing their parsing and evaluation logic from scratch rather than delegating to Rust's well-tested implementations.
- **Performance**: A TypeScript implementation will be slower than optimized Rust/WASM for very large policy sets (thousands of policies). For typical workloads (tens to low hundreds of policies), the difference is negligible.

### Mitigations

- We will track Cedar specification releases and maintain a compatibility matrix.
- We will structure the codebase to make adding new operators or value types straightforward.
- Extension types (IP, decimal) are stubbed in the initial release and will be implemented in a follow-up.
