# ADR-005: Schema Validation

## Status

Accepted

## Date

2025-01-12

## Context

Cedar supports validating policies against a schema at author time, before any request is evaluated. The schema describes:

- Which entity types exist and what attributes they have
- Which actions exist and what principal/resource types they apply to
- What types attributes have (String, Long, Boolean, Set, Record, Entity reference)

Schema validation catches errors that would otherwise only surface at evaluation time:

- Referencing an entity type that doesn't exist (`Unknown::"x"`)
- Accessing an attribute that isn't defined on an entity type (`user.nonexistent`)
- Applying an operator to incompatible types (`"hello" + 1`)
- Using an undefined action (`Action::"fly"`)

The question is when and how to perform this validation.

**Option A: Validate during parsing.** The parser receives a schema and rejects policies that don't conform. This catches errors early but couples the parser to the schema, making it impossible to parse policies without a schema (e.g., for syntax highlighting or formatting).

**Option B: Validate during evaluation.** Type errors are caught at runtime when a policy condition is evaluated. This is what already happens naturally — accessing a nonexistent attribute throws an error that is caught and recorded in diagnostics. But it only catches errors on the code paths that are actually exercised by real requests.

**Option C: Validate as a separate pass over the AST.** After parsing, optionally run a validation pass that walks the AST and checks it against a schema. This is independent of both parsing and evaluation.

## Decision

We implement schema validation as a separate pass over the AST (Option C).

The validator:

1. Takes an array of parsed `Policy` objects and a `CedarSchema`.
2. Walks each policy's scope constraints and condition expressions.
3. Checks entity types, action references, attribute accesses, and operator type compatibility.
4. Returns a `ValidationResult` with a list of `ValidationError` objects, each carrying a message, policy ID, and source span.

The validator performs lightweight type inference — it infers the type of each expression (Boolean, Long, String, Entity, Set, Record, or Any) and checks that operators receive compatible operand types.

### Schema Shape

```typescript
interface CedarSchema {
  namespace?: string;
  entityTypes: Record<string, EntityTypeSchema>;
  actions: Record<string, ActionSchema>;
}
```

This mirrors the structure of Cedar's JSON schema format, making it straightforward to load schemas from the standard Cedar toolchain.

## Consequences

### Positive

- **Optional**: Validation is entirely opt-in. Users who don't have a schema, or who are just prototyping, can skip it entirely. The parser and evaluator work without any schema.
- **Zero runtime cost**: Validation runs at policy authoring time, not at request evaluation time. There is no performance overhead during authorization.
- **Composable**: The validator can be used independently — for example, in a CI pipeline that validates policies against a schema before deployment, without needing an entity store or request context.
- **All errors at once**: Unlike evaluation (which stops at the first error in a condition), the validator reports all errors across all policies in a single pass.

### Negative

- **Conservative type inference**: The validator infers types conservatively. When it cannot determine an expression's type (e.g., the result of an attribute access on a variable whose type depends on the scope constraint), it uses the `Any` type and skips further checking. This means some errors may not be caught.
- **No flow-sensitive typing**: The validator does not track that `resource has attr && resource.attr == "x"` is safe — it does not propagate type narrowing through `&&`. This could produce false positives in some cases, though in practice we err on the side of permissiveness (using `Any` rather than flagging uncertain cases).
- **Schema must be provided separately**: There is no automatic schema discovery or inference. Users must construct the schema object themselves or load it from a JSON file.
- **Attribute validation limited to entity literals**: We can only validate attribute accesses when the left-hand side is an entity UID literal (e.g., `User::"alice".name`). Attribute accesses on variables (`resource.name`) would require resolving the variable's entity type from the scope constraint, which adds complexity and is deferred to a future enhancement.

### Future Enhancements

- Resolve variable types from scope constraints (e.g., if `resource == Document::"x"`, then `resource` has type `Document` and its attributes can be validated).
- Validate context attributes against the action's context type schema.
- Support extension type validation (IP, decimal) once those types are implemented.
