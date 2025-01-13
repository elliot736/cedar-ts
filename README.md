<p align="center">
<h1 align="center">cedar-ts</h1>
<p align="center">A pure TypeScript implementation of the AWS Cedar policy language.<br/>Parser, evaluator, and validator with zero dependencies.</p>
</p>

<p align="center">
  <a href="#why-cedar-ts">Why cedar-ts</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#api-reference">API Reference</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#performance">Performance</a> &middot;
  <a href="#comparison">Comparison</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="#license">License</a>
</p>

## Table of Contents

- [Why cedar-ts](#why-cedar-ts)
- [Features](#features)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Parsing Policies](#parsing-policies)
  - [Entity Store](#entity-store)
  - [Authorization](#authorization)
  - [Schema Validation](#schema-validation)
  - [Multi-Tenant SaaS Example](#multi-tenant-saas-example)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Performance](#performance)
- [Comparison](#comparison)
- [Development](#development)
- [License](#license)

---

## Why cedar-ts

[Cedar](https://www.cedarpolicy.com/) is AWS's open-source policy language for authorization, designed to be analyzable, auditable, and fast. The official SDK is written in Rust, with JavaScript bindings available only through a 2MB+ WASM blob that is opaque to debuggers, cannot be tree-shaken, and has limited compatibility with edge runtimes like Cloudflare Workers.

**cedar-ts** is a native TypeScript reimplementation that gives you a fully debuggable, tree-shakeable, edge-ready Cedar engine in under 15KB gzipped. No WASM, no native dependencies, no async initialization.

---

## Features

- **Full Cedar policy language support.** `permit`, `forbid`, `when`, `unless`, annotations, all scope constraint forms.
- **Entity hierarchy with transitive ancestry.** DFS resolution with cycle protection and caching.
- **Schema validation at author time.** Catch type errors, unknown entities, and invalid attributes before deployment.
- **Zero dependencies, pure TypeScript.** Nothing to audit, nothing to break.
- **Edge-ready.** Runs on Cloudflare Workers, Deno Deploy, Vercel Edge, Bun, Node.js, and browsers.
- **Rich diagnostics.** Know exactly which policies matched, which were denied, and why evaluation failed.
- **Synchronous API.** No async initialization, no WASM instantiation step.
- **Tree-shakeable ESM.** Import only what you need; bundlers eliminate the rest.

---

## Quick Start

```bash
npm install github:elliot736/cedar-ts
```

```typescript
import { Authorizer, MemoryEntityStore } from "cedar-ts";

const entities = new MemoryEntityStore([
  { uid: { type: "User", id: "alice" }, attrs: { role: "admin" }, parents: [{ type: "Team", id: "engineering" }] },
  { uid: { type: "Team", id: "engineering" }, attrs: {}, parents: [] },
  { uid: { type: "Document", id: "roadmap" }, attrs: { isPublic: false }, parents: [{ type: "Folder", id: "docs" }] },
  { uid: { type: "Folder", id: "docs" }, attrs: {}, parents: [] },
]);

const authorizer = Authorizer.fromText(`
  permit(
    principal in Team::"engineering",
    action == Action::"view",
    resource in Folder::"docs"
  ) when { principal.role == "admin" };
`, entities);

const response = authorizer.isAuthorized({
  principal: { type: "User", id: "alice" },
  action: { type: "Action", id: "view" },
  resource: { type: "Document", id: "roadmap" },
  context: {},
});

console.log(response.decision);           // "allow"
console.log(response.diagnostics.reasons); // ["policy0"]
```

---

## Usage

### Parsing Policies

```typescript
import { parsePolicies, parseExpression } from "cedar-ts";

const { policies } = parsePolicies(`
  @id("admin-access")
  permit(
    principal in Group::"admins",
    action,
    resource in Folder::"shared"
  ) when { resource.isPublished == true };

  forbid(principal, action == Action::"delete", resource)
  when { resource has classification && resource.classification == "internal" };
`);

console.log(policies.length);        // 2
console.log(policies[0].effect);     // "permit"
console.log(policies[0].conditions); // [{ kind: "when", body: { ... } }]

// Parse standalone expressions for tooling / editors
const expr = parseExpression('resource.tags.contains("public")');
console.log(expr.kind); // "method_call"
```

---

### Entity Store

```typescript
import { MemoryEntityStore } from "cedar-ts";

const store = new MemoryEntityStore([
  { uid: { type: "User", id: "alice" },    attrs: { role: "admin" }, parents: [{ type: "Group", id: "eng" }] },
  { uid: { type: "Group", id: "eng" },     attrs: {},               parents: [{ type: "Org", id: "acme" }] },
  { uid: { type: "Org", id: "acme" },      attrs: {},               parents: [] },
]);

// Transitive ancestry resolution
const ancestors = store.getAncestors({ type: "User", id: "alice" });
// Set { 'Group::"eng"', 'Org::"acme"' }

// Dynamic updates
store.add({ uid: { type: "User", id: "bob" }, attrs: { role: "viewer" }, parents: [{ type: "Group", id: "eng" }] });
store.remove({ type: "User", id: "bob" });
```

---

### Authorization

```typescript
import { Authorizer, MemoryEntityStore } from "cedar-ts";

const store = new MemoryEntityStore([
  { uid: { type: "User", id: "alice" }, attrs: {}, parents: [] },
]);

const auth = Authorizer.fromText(`
  permit(principal == User::"alice", action == Action::"read", resource);
  forbid(principal, action == Action::"read", resource)
  unless { resource.isPublic == true };
`, store);

// Permit matches, but forbid also matches (resource has no isPublic attr, errors, forbid does not match)
// Result: allowed by permit
const result = auth.isAuthorized({
  principal: { type: "User", id: "alice" },
  action: { type: "Action", id: "read" },
  resource: { type: "Document", id: "doc1" },
  context: {},
});

console.log(result.decision);             // "allow"
console.log(result.diagnostics.reasons);   // ["policy0"]
console.log(result.diagnostics.errors);    // [EvaluationError] (forbid errored on missing entity)
```

---

### Schema Validation

```typescript
import { parsePolicies, validatePolicies } from "cedar-ts";
import type { CedarSchema } from "cedar-ts";

const schema: CedarSchema = {
  entityTypes: {
    User:     { shape: { type: "Record", attributes: { name: { type: { type: "String" } }, role: { type: { type: "String" } } } } },
    Document: { shape: { type: "Record", attributes: { title: { type: { type: "String" } }, isPublic: { type: { type: "Boolean" } } } } },
  },
  actions: {
    view: { appliesTo: { principalTypes: ["User"], resourceTypes: ["Document"] } },
  },
};

const { policies } = parsePolicies(`
  permit(principal == User::"alice", action == Action::"view", resource)
  when { resource.isPublic == true };
`);

const result = validatePolicies(policies, schema);
console.log(result.valid);  // true
console.log(result.errors); // []
```

---

### Multi-Tenant SaaS Example

```typescript
import { Authorizer, MemoryEntityStore } from "cedar-ts";

const store = new MemoryEntityStore([
  // Tenants
  { uid: { type: "Tenant", id: "acme" }, attrs: { plan: "enterprise" }, parents: [] },
  // Users
  { uid: { type: "User", id: "alice" }, attrs: { role: "admin" },  parents: [{ type: "Tenant", id: "acme" }] },
  { uid: { type: "User", id: "bob" },   attrs: { role: "viewer" }, parents: [{ type: "Tenant", id: "acme" }] },
  { uid: { type: "User", id: "carol" }, attrs: { role: "admin" },  parents: [{ type: "Tenant", id: "initech" }] },
  // Resources
  { uid: { type: "Document", id: "roadmap" }, attrs: { isPublic: false }, parents: [{ type: "Tenant", id: "acme" }] },
]);

const authorizer = Authorizer.fromText(`
  // Admins can do anything in their tenant
  permit(principal, action, resource in Tenant::"acme")
  when { principal in Tenant::"acme" && principal.role == "admin" };

  // Viewers can only read in their tenant
  permit(principal in Tenant::"acme", action == Action::"read", resource in Tenant::"acme")
  when { principal.role == "viewer" };
`, store);

authorizer.isAuthorized({ principal: { type: "User", id: "alice" }, action: { type: "Action", id: "write" }, resource: { type: "Document", id: "roadmap" }, context: {} }).decision;
// => "allow" (admin)

authorizer.isAuthorized({ principal: { type: "User", id: "bob" }, action: { type: "Action", id: "write" }, resource: { type: "Document", id: "roadmap" }, context: {} }).decision;
// => "deny" (viewer, write not permitted)

authorizer.isAuthorized({ principal: { type: "User", id: "bob" }, action: { type: "Action", id: "read" }, resource: { type: "Document", id: "roadmap" }, context: {} }).decision;
// => "allow" (viewer, read permitted)

authorizer.isAuthorized({ principal: { type: "User", id: "carol" }, action: { type: "Action", id: "read" }, resource: { type: "Document", id: "roadmap" }, context: {} }).decision;
// => "deny" (different tenant)
```

---

## API Reference

### `parsePolicies(source: string): PolicySet`

Parse Cedar policy text into an AST. Returns `{ policies: Policy[] }`.

### `parseExpression(source: string): Expr`

Parse a standalone Cedar expression. Useful for tooling, editors, and testing.

### `class Authorizer`

High-level authorization engine.

```typescript
// Create from Cedar text
const auth = Authorizer.fromText(policyText, entityStore);

// Create from pre-parsed policies
const auth = new Authorizer(policies, entityStore);

// Evaluate a request
const result: AuthorizationResponse = auth.isAuthorized(request);

// Runtime policy management
auth.addPoliciesFromText(morePolicies);
auth.addPolicies(parsedPolicies);
auth.setEntityStore(newStore);
auth.getPolicies(); // readonly access
```

### `class MemoryEntityStore`

In-memory entity store with cached transitive ancestry.

```typescript
const store = new MemoryEntityStore(entities?);
store.add(entity);
store.remove(uid);
store.get(uid);            // Entity | undefined
store.getAncestors(uid);   // Set<string>
store.size;                // number
```

### `validatePolicies(policies: Policy[], schema: CedarSchema): ValidationResult`

Static validation of policies against a schema. Checks entity types, actions, attribute accesses, and type compatibility.

### `evaluate(policies, entityStore, request): AuthorizationResponse`

Low-level evaluation function. Use `Authorizer` for a higher-level API.

---

## Architecture

### Class Diagram

![Class Diagram](docs/class-diagram.png)

### Component Diagram

![Component Diagram](docs/component-diagram.png)

### Sequence Diagram

![Sequence Diagram](docs/sequence-diagram.png)

### Algorithm and Design Decisions

- **Recursive descent parser.** Hand-written for full control over error messages and zero parser-generator dependencies.
- **Default deny.** If no `permit` policy matches, the request is denied (matches Cedar specification).
- **Forbid wins.** A single matching `forbid` overrides any number of matching `permit` policies.
- **Transitive ancestry.** DFS traversal with cycle protection via a visited set. Results are cached per entity and invalidated on store mutation.
- **Short-circuit evaluation.** `&&` and `||` short-circuit, matching Cedar's defined evaluation order.

See [Architecture Decision Records](docs/adr/) for detailed rationale behind each design choice.

---

## Performance

| Operation | Scale | Time |
|-----------|-------|------|
| Parse | 100 policies | < 5ms |
| Evaluate | 100 policies x 1 request | < 1ms |
| Entity ancestry | 20-level hierarchy | < 0.1ms |
| Full authorization | 100 entities, complex policies | < 2ms |

Sub-millisecond evaluation for typical workloads (< 100 policies). Benchmarked on Node.js 20, Apple M-series.

---

## Comparison

| Feature | cedar-ts | @cedar-policy/cedar-wasm | Custom if/else |
|---------|----------|--------------------------|----------------|
| Runtime | Native TS | WASM blob | N/A |
| Bundle size | ~15KB | ~2MB | Grows with rules |
| Debuggable | Step-through | Opaque | Step-through |
| Edge runtime | Full support | Limited WASM support | Full support |
| Auditable | Policy files | Policy files | Scattered code |
| Type-safe validation | Schema validation | Schema validation | Manual |
| Tree-shakeable | Yes | No | N/A |
| Dependencies | 0 | Native/WASM | N/A |
| Async init | No | Required | No |

---

## Development

```bash
npm run lint        # Lint the codebase
npm run typecheck   # Run TypeScript type checking
npm test            # Run the test suite
```

---

## License

MIT
