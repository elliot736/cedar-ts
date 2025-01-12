# ADR-004: Evaluation Semantics

## Status

Accepted

## Date

2025-01-12

## Context

Cedar's authorization model has precise semantics defined in the Cedar specification. The key properties are:

1. **Default deny**: If no policy explicitly permits a request, it is denied.
2. **Forbid overrides permit**: If any `forbid` policy is satisfied, the request is denied regardless of how many `permit` policies are also satisfied.
3. **Independent evaluation**: Each policy is evaluated independently. Policies do not interact with each other during evaluation — they are combined only at the final decision stage.
4. **Error handling**: If a policy's condition throws an error during evaluation (e.g., accessing a nonexistent attribute), that policy is treated as not satisfied, and the error is recorded in diagnostics.
5. **Diagnostics**: The authorization response includes not just the decision but also which policies contributed to it and any errors that occurred.

Alternative approaches exist in other authorization systems:

- **First-match**: Evaluate policies in order, return the first match. Used by some firewalls. Simpler but order-dependent and harder to reason about.
- **Scoring/weighting**: Assign weights to policies, compute a score. Used in some ML-based access control. Flexible but opaque.
- **Custom conflict resolution**: Let users define how to resolve permit/forbid conflicts. Maximum flexibility but hard to audit.

## Decision

We implement strict Cedar evaluation semantics:

1. **Scope matching**: For each policy, check whether the request's principal, action, and resource match the policy's scope constraints. This includes entity hierarchy traversal for `in` constraints and type checking for `is` constraints.

2. **Condition evaluation**: For policies whose scope matches, evaluate `when` conditions (must evaluate to `true`) and `unless` conditions (must evaluate to `false`). Both condition types must be satisfied for the policy to be considered satisfied.

3. **Decision logic**:
   - Collect all satisfied `forbid` policies and all satisfied `permit` policies.
   - If any `forbid` policy is satisfied: decision is **deny**, and the forbid policy IDs are the reasons.
   - Else if any `permit` policy is satisfied: decision is **allow**, and the permit policy IDs are the reasons.
   - Else: decision is **deny** (default deny), with no reasons.

4. **Error handling**: If evaluating a policy's conditions throws an error, the policy is treated as not satisfied. The error is captured in `diagnostics.errors` with the associated policy ID.

5. **Short-circuit evaluation**: Boolean operators `&&` and `||` use short-circuit evaluation, matching Cedar's specification. This is important for patterns like `resource has attr && resource.attr == value`, where the right side would error if evaluated when the attribute doesn't exist.

### Response Shape

```typescript
interface AuthorizationResponse {
  decision: "allow" | "deny";
  diagnostics: {
    reasons: string[];   // Policy IDs that contributed to the decision
    errors: Error[];      // Errors from policy evaluation
  };
}
```

## Consequences

### Positive

- **Correct**: Our evaluation produces the same results as the reference Cedar implementation for all well-formed inputs.
- **Auditable**: The diagnostics tell you exactly which policies led to a decision. This is essential for debugging authorization issues in production ("why was this request denied?").
- **Predictable**: The forbid-overrides-permit model is simple to reason about. Policy authors can be confident that a `forbid` policy will always take effect, regardless of what `permit` policies exist.
- **Safe by default**: Default deny means that missing or misconfigured policies fail closed. A system with no policies denies everything.

### Negative

- **No soft deny**: There is no way to express "deny unless a stronger permit overrides." The forbid-overrides-permit model is absolute. This is by design in Cedar, but may surprise users coming from more flexible systems.
- **No policy ordering**: Policies are evaluated as an unordered set. There is no way to say "evaluate this policy first" or "this policy has higher priority." Conflicts are resolved purely by the forbid-overrides-permit rule.
- **Error swallowing**: A policy that errors during evaluation is silently treated as not satisfied. While the error is recorded in diagnostics, it does not cause the overall evaluation to fail. This can mask bugs in policies.

### Expression Evaluation Details

The expression evaluator implements:

- **Arithmetic**: `+`, `-`, `*` on Long values, with type checking.
- **Comparison**: `<`, `<=`, `>`, `>=` on Long values; `==`, `!=` on any value with structural equality.
- **Boolean logic**: `&&`, `||` with short-circuit; `!` for negation.
- **Entity operations**: `in` for hierarchy membership, `has` for attribute existence, `is` for type checking.
- **String matching**: `like` with `*` wildcard support.
- **Member access**: `.attr` for attribute access on entities and records.
- **Method calls**: `.contains()`, `.containsAll()`, `.containsAny()` on sets.
- **Constructors**: Set literals `[1, 2, 3]`, record literals `{"key": value}`.
- **Conditional**: `if cond then a else b` as a ternary expression.
