# ADR-003: Entity Store Interface

## Status

Accepted

## Date

2025-01-12

## Context

Cedar policy evaluation requires access to entity data. When a policy references `principal in Group::"admins"`, the evaluator needs to look up the principal entity and traverse its parent hierarchy to determine group membership. When a policy accesses `resource.owner`, the evaluator needs to retrieve the resource entity's attributes.

There are two broad approaches to providing entity data:

1. **Baked-in storage**: The library ships with a specific storage mechanism (e.g., an in-memory map) and all entity data must be loaded into it before evaluation. This is simple but inflexible — users with entities in PostgreSQL, DynamoDB, or an external service would need to copy all relevant entities into memory before every authorization check.

2. **Abstract interface**: Define an `EntityStore` interface that the evaluator depends on, and let users provide their own implementation. Ship a default in-memory implementation for simple use cases.

In real-world authorization systems, entity data lives in many places:

- Application databases (PostgreSQL, MySQL, MongoDB)
- Cloud services (DynamoDB, Firestore)
- Identity providers (Auth0, Okta)
- In-memory caches (Redis, local process memory)
- External APIs (microservices, graph databases)

Forcing all entity data into a single in-memory map is impractical for large-scale systems where the entity graph may be too large to fit in memory, or where the canonical data source is a database that should be queried on demand.

## Decision

We define an `EntityStore` interface with two methods:

```typescript
interface EntityStore {
  get(uid: EntityUID): Entity | undefined;
  getAncestors(uid: EntityUID): Set<string>;
}
```

We ship a `MemoryEntityStore` class that implements this interface using an in-memory `Map`, with automatic transitive ancestry computation and caching.

### Interface Design Rationale

- **`get(uid)`** returns a single entity by its UID, or `undefined` if not found. This is the minimal operation needed for attribute access during evaluation.
- **`getAncestors(uid)`** returns the full set of transitive parent UIDs as strings. This is needed for `in` operator evaluation and scope matching. Returning `Set<string>` (rather than `Set<EntityUID>`) avoids the need for custom set equality — string comparison is sufficient since the key format `Type::"id"` is canonical.
- The interface is deliberately **synchronous**. Cedar policy evaluation is a hot path — introducing async/await would require every evaluator function to be async, which has significant performance and ergonomic costs. Users who need to fetch entities from a database should pre-load relevant entities before evaluation, or use a caching layer that makes lookups synchronous.

## Consequences

### Positive

- **Pluggable**: Users can implement `EntityStore` backed by any data source. A PostgreSQL-backed store, a DynamoDB-backed store, or a Redis-cached store all work without changing the evaluator.
- **Testable**: Tests can use `MemoryEntityStore` with hand-crafted entity graphs, making test setup trivial.
- **Separation of concerns**: The evaluator has no knowledge of how entities are stored or fetched. Storage logic is entirely the user's responsibility.
- **Incrementally loadable**: A custom `EntityStore` implementation can lazily load entities as they are accessed, caching them for the duration of a single authorization request.

### Negative

- **Synchronous constraint**: The interface is synchronous, which means entity data must be available in memory (or in a synchronous cache) at evaluation time. Users with purely async data sources must pre-fetch entities.
- **Ancestry computation**: The `getAncestors` method requires the implementation to compute transitive closure. For the in-memory store this is straightforward (DFS with cycle detection), but custom implementations must handle this correctly, including cycle protection.
- **No batch API**: The interface fetches one entity at a time. A batch `getMany(uids)` method could reduce round-trips for database-backed stores. This can be added as an optional optimization in the future.

### MemoryEntityStore Implementation

The shipped `MemoryEntityStore`:

- Stores entities in a `Map<string, Entity>` keyed by `entityUIDKey(uid)`.
- Computes transitive ancestors on demand via DFS with cycle detection.
- Caches ancestor sets and invalidates the cache when entities are added or removed.
- Supports `add(entity)`, `remove(uid)`, and `size` for entity management.
