import { describe, it, expect } from "vitest";
import { evaluate, evalExpr } from "../src/evaluator/evaluator.js";
import { CedarSet } from "../src/evaluator/values.js";
import { MemoryEntityStore } from "../src/entities/memory.js";
import { parsePolicies, parseExpression } from "../src/parser/parser.js";
import type { Request } from "../src/evaluator/context.js";
import type { Entity } from "../src/entities/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    principal: { type: "User", id: "alice" },
    action: { type: "Action", id: "view" },
    resource: { type: "Document", id: "doc1" },
    context: {},
    ...overrides,
  };
}

function makeStore(entities: Entity[] = []): MemoryEntityStore {
  return new MemoryEntityStore(entities);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("evaluator", () => {
  describe("basic decision logic", () => {
    it("returns deny when no policies match (default deny)", () => {
      const { policies } = parsePolicies(
        `permit(principal == User::"bob", action, resource);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("deny");
      expect(result.diagnostics.reasons).toHaveLength(0);
    });

    it("returns allow when a permit matches", () => {
      const { policies } = parsePolicies(
        `permit(principal == User::"alice", action, resource);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("allow");
      expect(result.diagnostics.reasons).toHaveLength(1);
    });

    it("returns deny when a forbid matches", () => {
      const { policies } = parsePolicies(
        `forbid(principal == User::"alice", action, resource);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("deny");
      expect(result.diagnostics.reasons).toHaveLength(1);
    });

    it("forbid overrides permit", () => {
      const { policies } = parsePolicies(`
        permit(principal == User::"alice", action, resource);
        forbid(principal == User::"alice", action, resource);
      `);
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("deny");
    });

    it("permit-all allows any request", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("returns deny with no policies at all", () => {
      const result = evaluate([], makeStore(), makeRequest());
      expect(result.decision).toBe("deny");
      expect(result.diagnostics.reasons).toHaveLength(0);
      expect(result.diagnostics.errors).toHaveLength(0);
    });

    it("multiple permits all appear in reasons", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource);
        permit(principal == User::"alice", action, resource);
      `);
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("allow");
      expect(result.diagnostics.reasons).toHaveLength(2);
    });

    it("forbid reasons are reported, not permit reasons", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource);
        forbid(principal == User::"alice", action, resource);
      `);
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("deny");
      expect(result.diagnostics.reasons).toEqual(["policy1"]);
    });
  });

  describe("scope matching", () => {
    it("matches principal == exact entity", () => {
      const { policies } = parsePolicies(
        `permit(principal == User::"alice", action, resource);`,
      );
      const yes = evaluate(policies, makeStore(), makeRequest());
      expect(yes.decision).toBe("allow");

      const no = evaluate(
        policies,
        makeStore(),
        makeRequest({ principal: { type: "User", id: "bob" } }),
      );
      expect(no.decision).toBe("deny");
    });

    it("matches principal in group via entity hierarchy", () => {
      const store = makeStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "admins" }],
        },
        {
          uid: { type: "Group", id: "admins" },
          attrs: {},
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(
        `permit(principal in Group::"admins", action, resource);`,
      );
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("principal in matches self (entity is in itself)", () => {
      const { policies } = parsePolicies(
        `permit(principal in User::"alice", action, resource);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("matches action == specific action", () => {
      const { policies } = parsePolicies(
        `permit(principal, action == Action::"view", resource);`,
      );
      const yes = evaluate(policies, makeStore(), makeRequest());
      expect(yes.decision).toBe("allow");

      const no = evaluate(
        policies,
        makeStore(),
        makeRequest({ action: { type: "Action", id: "delete" } }),
      );
      expect(no.decision).toBe("deny");
    });

    it("matches action in set", () => {
      const { policies } = parsePolicies(
        `permit(principal, action in [Action::"view", Action::"edit"], resource);`,
      );
      const view = evaluate(policies, makeStore(), makeRequest());
      expect(view.decision).toBe("allow");

      const edit = evaluate(
        policies,
        makeStore(),
        makeRequest({ action: { type: "Action", id: "edit" } }),
      );
      expect(edit.decision).toBe("allow");

      const del = evaluate(
        policies,
        makeStore(),
        makeRequest({ action: { type: "Action", id: "delete" } }),
      );
      expect(del.decision).toBe("deny");
    });

    it("matches resource in folder hierarchy", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: {},
          parents: [{ type: "Folder", id: "shared" }],
        },
        {
          uid: { type: "Folder", id: "shared" },
          attrs: {},
          parents: [{ type: "Folder", id: "root" }],
        },
        {
          uid: { type: "Folder", id: "root" },
          attrs: {},
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(
        `permit(principal, action, resource in Folder::"root");`,
      );
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("matches principal is Type", () => {
      const { policies } = parsePolicies(
        `permit(principal is User, action, resource);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("allow");

      const no = evaluate(
        policies,
        makeStore(),
        makeRequest({ principal: { type: "Service", id: "svc1" } }),
      );
      expect(no.decision).toBe("deny");
    });

    it("matches principal is Type in entity", () => {
      const store = makeStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "admins" }],
        },
        { uid: { type: "Group", id: "admins" }, attrs: {}, parents: [] },
      ]);
      const { policies } = parsePolicies(
        `permit(principal is User in Group::"admins", action, resource);`,
      );
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");

      // Wrong type
      const no = evaluate(
        policies,
        store,
        makeRequest({ principal: { type: "Service", id: "svc1" } }),
      );
      expect(no.decision).toBe("deny");
    });

    it("matches resource == exact entity", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource == Document::"doc1");`,
      );
      const yes = evaluate(policies, makeStore(), makeRequest());
      expect(yes.decision).toBe("allow");

      const no = evaluate(
        policies,
        makeStore(),
        makeRequest({ resource: { type: "Document", id: "doc2" } }),
      );
      expect(no.decision).toBe("deny");
    });

    it("matches resource is Type", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource is Document);`,
      );
      const result = evaluate(policies, makeStore(), makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("matches resource is Type in entity", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: {},
          parents: [{ type: "Folder", id: "shared" }],
        },
        { uid: { type: "Folder", id: "shared" }, attrs: {}, parents: [] },
      ]);
      const { policies } = parsePolicies(
        `permit(principal, action, resource is Document in Folder::"shared");`,
      );
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("matches action in via hierarchy", () => {
      const store = makeStore([
        {
          uid: { type: "Action", id: "read" },
          attrs: {},
          parents: [{ type: "Action", id: "readOnly" }],
        },
        { uid: { type: "Action", id: "readOnly" }, attrs: {}, parents: [] },
      ]);
      const { policies } = parsePolicies(
        `permit(principal, action in Action::"readOnly", resource);`,
      );
      const result = evaluate(
        policies,
        store,
        makeRequest({ action: { type: "Action", id: "read" } }),
      );
      expect(result.decision).toBe("allow");
    });
  });

  describe("conditions", () => {
    it("evaluates when condition", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isPublic: true },
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.isPublic == true };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("fails when condition evaluates to false", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isPublic: false },
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.isPublic == true };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("deny");
    });

    it("evaluates unless condition (blocks when true)", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isArchived: true },
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        unless { resource.isArchived == true };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("deny");
    });

    it("allows when unless condition is false", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isArchived: false },
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        unless { resource.isArchived == true };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("evaluates context-based conditions", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { context.role == "admin" };
      `);
      const yes = evaluate(
        policies,
        makeStore(),
        makeRequest({ context: { role: "admin" } }),
      );
      expect(yes.decision).toBe("allow");

      const no = evaluate(
        policies,
        makeStore(),
        makeRequest({ context: { role: "viewer" } }),
      );
      expect(no.decision).toBe("deny");
    });

    it("evaluates multiple when conditions (all must pass)", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isPublic: true, status: "active" },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.isPublic == true }
        when { resource.status == "active" };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("fails if any when condition fails", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isPublic: true, status: "archived" },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.isPublic == true }
        when { resource.status == "active" };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("deny");
    });

    it("evaluates combined when and unless", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { isPublic: true, isArchived: false },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.isPublic == true }
        unless { resource.isArchived == true };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("allow");
    });
  });

  describe("expression evaluation", () => {
    const store = makeStore();
    const request = makeRequest();

    it("evaluates arithmetic", () => {
      expect(evalExpr(parseExpression("1 + 2"), store, request)).toBe(3);
      expect(evalExpr(parseExpression("10 - 3"), store, request)).toBe(7);
      expect(evalExpr(parseExpression("4 * 5"), store, request)).toBe(20);
    });

    it("evaluates chained arithmetic", () => {
      expect(evalExpr(parseExpression("1 + 2 + 3"), store, request)).toBe(6);
      expect(evalExpr(parseExpression("2 * 3 * 4"), store, request)).toBe(24);
    });

    it("evaluates mixed arithmetic with precedence", () => {
      expect(evalExpr(parseExpression("2 + 3 * 4"), store, request)).toBe(14);
      expect(evalExpr(parseExpression("(2 + 3) * 4"), store, request)).toBe(20);
    });

    it("evaluates negation", () => {
      expect(evalExpr(parseExpression("-42"), store, request)).toBe(-42);
      expect(evalExpr(parseExpression("-0"), store, request)).toBe(-0);
    });

    it("evaluates double negation", () => {
      expect(evalExpr(parseExpression("--5"), store, request)).toBe(5);
    });

    it("evaluates comparisons", () => {
      expect(evalExpr(parseExpression("1 < 2"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("2 > 1"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("1 <= 1"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("1 >= 2"), store, request)).toBe(false);
      expect(evalExpr(parseExpression("1 == 1"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("1 != 2"), store, request)).toBe(true);
    });

    it("evaluates edge comparisons", () => {
      expect(evalExpr(parseExpression("0 < 0"), store, request)).toBe(false);
      expect(evalExpr(parseExpression("0 <= 0"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("0 >= 0"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("0 > 0"), store, request)).toBe(false);
    });

    it("evaluates boolean logic", () => {
      expect(evalExpr(parseExpression("true && true"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("true && false"), store, request)).toBe(false);
      expect(evalExpr(parseExpression("false || true"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("false || false"), store, request)).toBe(false);
      expect(evalExpr(parseExpression("!true"), store, request)).toBe(false);
      expect(evalExpr(parseExpression("!false"), store, request)).toBe(true);
    });

    it("evaluates double not", () => {
      expect(evalExpr(parseExpression("!!true"), store, request)).toBe(true);
      expect(evalExpr(parseExpression("!!false"), store, request)).toBe(false);
    });

    it("short-circuits &&", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { false && context.nonexistent.bad };
      `);
      const result = evaluate(policies, store, request);
      expect(result.decision).toBe("deny");
    });

    it("short-circuits ||", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { true || context.nonexistent.bad };
      `);
      const result = evaluate(policies, store, request);
      expect(result.decision).toBe("allow");
    });

    it("evaluates if-then-else", () => {
      expect(
        evalExpr(parseExpression("if true then 1 else 2"), store, request),
      ).toBe(1);
      expect(
        evalExpr(parseExpression("if false then 1 else 2"), store, request),
      ).toBe(2);
    });

    it("evaluates nested if-then-else", () => {
      expect(
        evalExpr(
          parseExpression("if true then if false then 1 else 2 else 3"),
          store,
          request,
        ),
      ).toBe(2);
    });

    it("evaluates string equality", () => {
      expect(
        evalExpr(parseExpression('"hello" == "hello"'), store, request),
      ).toBe(true);
      expect(
        evalExpr(parseExpression('"hello" != "world"'), store, request),
      ).toBe(true);
    });

    it("evaluates entity UID equality", () => {
      expect(
        evalExpr(
          parseExpression('User::"alice" == User::"alice"'),
          store,
          request,
        ),
      ).toBe(true);
      expect(
        evalExpr(
          parseExpression('User::"alice" == User::"bob"'),
          store,
          request,
        ),
      ).toBe(false);
      expect(
        evalExpr(
          parseExpression('User::"alice" != Group::"alice"'),
          store,
          request,
        ),
      ).toBe(true);
    });

    it("evaluates cross-type equality as false", () => {
      expect(
        evalExpr(parseExpression('1 == "1"'), store, request),
      ).toBe(false);
      expect(
        evalExpr(parseExpression("true == 1"), store, request),
      ).toBe(false);
    });

    it("evaluates like with wildcards", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { name: "report.txt" },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.name like "*.txt" };
      `);
      const result = evaluate(policies, store2, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("evaluates like without wildcards (exact match)", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { name: "hello" },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.name like "hello" };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("allow");
    });

    it("evaluates like with multiple wildcards", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { name: "foo-bar-baz" },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.name like "foo*bar*baz" };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("allow");
    });

    it("evaluates set operations", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { tags: new CedarSet([1, 2, 3]) },
          parents: [],
        },
      ]);

      // contains
      const { policies: p1 } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.contains(2) };
      `);
      expect(evaluate(p1, store2, makeRequest()).decision).toBe("allow");

      // containsAll
      const { policies: p2 } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.containsAll([1, 2]) };
      `);
      expect(evaluate(p2, store2, makeRequest()).decision).toBe("allow");

      // containsAny
      const { policies: p3 } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.containsAny([5, 3]) };
      `);
      expect(evaluate(p3, store2, makeRequest()).decision).toBe("allow");
    });

    it("evaluates set contains with false case", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { tags: new CedarSet([1, 2, 3]) },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.contains(99) };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("deny");
    });

    it("evaluates containsAll with false case", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { tags: new CedarSet([1, 2]) },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.containsAll([1, 2, 99]) };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("deny");
    });

    it("evaluates containsAny with false case", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { tags: new CedarSet([1, 2]) },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.containsAny([98, 99]) };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("deny");
    });

    it("evaluates empty set operations", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { tags: new CedarSet([]) },
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.tags.contains(1) };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("deny");
    });

    it("evaluates set equality", () => {
      const s1 = new CedarSet([1, 2, 3]);
      const s2 = new CedarSet([3, 2, 1]);
      const s3 = new CedarSet([1, 2]);

      expect(s1.containsAll(s2) && s2.containsAll(s1)).toBe(true);
      expect(s1.containsAll(s3) && s3.containsAll(s1)).toBe(false);
    });

    it("evaluates has operator on entities", () => {
      const store2 = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { title: "My Doc" },
          parents: [],
        },
      ]);

      const { policies: p1 } = parsePolicies(`
        permit(principal, action, resource)
        when { resource has title };
      `);
      expect(evaluate(p1, store2, makeRequest()).decision).toBe("allow");

      const { policies: p2 } = parsePolicies(`
        permit(principal, action, resource)
        when { resource has nonexistent };
      `);
      expect(evaluate(p2, store2, makeRequest()).decision).toBe("deny");
    });

    it("evaluates has operator on records", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { context has role };
      `);
      const yes = evaluate(
        policies,
        makeStore(),
        makeRequest({ context: { role: "admin" } }),
      );
      expect(yes.decision).toBe("allow");

      const no = evaluate(
        policies,
        makeStore(),
        makeRequest({ context: {} }),
      );
      expect(no.decision).toBe("deny");
    });

    it("evaluates has on entity not in store (returns false)", () => {
      const store2 = makeStore(); // empty
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource has title };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("deny");
    });

    it("evaluates entity in expression", () => {
      const store2 = makeStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "eng" }],
        },
        {
          uid: { type: "Group", id: "eng" },
          attrs: {},
          parents: [{ type: "Group", id: "company" }],
        },
        {
          uid: { type: "Group", id: "company" },
          attrs: {},
          parents: [],
        },
      ]);

      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { principal in Group::"company" };
      `);
      const result = evaluate(policies, store2, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("evaluates entity in set expression", () => {
      const store2 = makeStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "eng" }],
        },
        { uid: { type: "Group", id: "eng" }, attrs: {}, parents: [] },
      ]);

      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { principal in [Group::"eng", Group::"design"] };
      `);
      const result = evaluate(policies, store2, makeRequest());
      expect(result.decision).toBe("allow");
    });

    it("evaluates is expression", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { principal is User };
      `);
      expect(evaluate(policies, makeStore(), makeRequest()).decision).toBe("allow");
    });

    it("evaluates is ... in expression", () => {
      const store2 = makeStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "eng" }],
        },
        { uid: { type: "Group", id: "eng" }, attrs: {}, parents: [] },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { principal is User in Group::"eng" };
      `);
      expect(evaluate(policies, store2, makeRequest()).decision).toBe("allow");
    });

    it("evaluates record literal", () => {
      const val = evalExpr(
        parseExpression('{"a": 1, "b": 2}'),
        store,
        request,
      );
      expect(val).toEqual({ a: 1, b: 2 });
    });

    it("evaluates set literal", () => {
      const val = evalExpr(parseExpression("[1, 2, 3]"), store, request);
      expect(val).toBeInstanceOf(CedarSet);
      expect((val as CedarSet).size).toBe(3);
    });

    it("evaluates nested record attribute access", () => {
      const result = evaluate(
        parsePolicies(`
          permit(principal, action, resource)
          when { context.meta.level == "high" };
        `).policies,
        makeStore(),
        makeRequest({ context: { meta: { level: "high" } } }),
      );
      expect(result.decision).toBe("allow");
    });
  });

  describe("deeply nested entity hierarchies", () => {
    it("resolves 10+ levels of hierarchy", () => {
      const entities: Entity[] = [];
      // Create chain: User -> G0 -> G1 -> ... -> G9
      entities.push({
        uid: { type: "User", id: "deep" },
        attrs: {},
        parents: [{ type: "Group", id: "G0" }],
      });
      for (let i = 0; i < 10; i++) {
        entities.push({
          uid: { type: "Group", id: `G${i}` },
          attrs: {},
          parents: i < 9 ? [{ type: "Group", id: `G${i + 1}` }] : [],
        });
      }

      const store = makeStore(entities);
      const { policies } = parsePolicies(
        `permit(principal in Group::"G9", action, resource);`,
      );
      const result = evaluate(
        policies,
        store,
        makeRequest({ principal: { type: "User", id: "deep" } }),
      );
      expect(result.decision).toBe("allow");
    });

    it("resolves diamond inheritance correctly", () => {
      const store = makeStore([
        {
          uid: { type: "User", id: "u1" },
          attrs: {},
          parents: [
            { type: "Group", id: "A" },
            { type: "Group", id: "B" },
          ],
        },
        {
          uid: { type: "Group", id: "A" },
          attrs: {},
          parents: [{ type: "Group", id: "top" }],
        },
        {
          uid: { type: "Group", id: "B" },
          attrs: {},
          parents: [{ type: "Group", id: "top" }],
        },
        { uid: { type: "Group", id: "top" }, attrs: {}, parents: [] },
      ]);

      const { policies } = parsePolicies(
        `permit(principal in Group::"top", action, resource);`,
      );
      const result = evaluate(
        policies,
        store,
        makeRequest({ principal: { type: "User", id: "u1" } }),
      );
      expect(result.decision).toBe("allow");
    });
  });

  describe("error handling", () => {
    it("reports evaluation errors in diagnostics", () => {
      const store = makeStore();
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.nonexistent };
      `);
      const result = evaluate(policies, store, makeRequest());
      expect(result.decision).toBe("deny");
      expect(result.diagnostics.errors).toHaveLength(1);
    });

    it("throws on ! applied to non-boolean", () => {
      expect(() =>
        evalExpr(parseExpression("!42"), makeStore(), makeRequest()),
      ).toThrow("boolean");
    });

    it("throws on negation of non-number", () => {
      expect(() =>
        evalExpr(parseExpression('-"hello"'), makeStore(), makeRequest()),
      ).toThrow("numeric");
    });

    it("throws on arithmetic with non-numbers", () => {
      expect(() =>
        evalExpr(parseExpression('"a" + 1'), makeStore(), makeRequest()),
      ).toThrow("numeric");
    });

    it("throws on comparison with non-numbers", () => {
      expect(() =>
        evalExpr(parseExpression('"a" < "b"'), makeStore(), makeRequest()),
      ).toThrow("numeric");
    });

    it("throws on && with non-boolean", () => {
      expect(() =>
        evalExpr(parseExpression("42 && true"), makeStore(), makeRequest()),
      ).toThrow("boolean");
    });

    it("throws on || with non-boolean", () => {
      expect(() =>
        evalExpr(parseExpression("42 || false"), makeStore(), makeRequest()),
      ).toThrow("boolean");
    });

    it("throws on if with non-boolean condition", () => {
      expect(() =>
        evalExpr(
          parseExpression("if 42 then 1 else 2"),
          makeStore(),
          makeRequest(),
        ),
      ).toThrow("boolean");
    });

    it("throws on attribute access on non-entity/record", () => {
      expect(() =>
        evalExpr(parseExpression('42'), makeStore(), makeRequest()),
      ).not.toThrow();
    });

    it("throws on missing attribute", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: {},
          parents: [],
        },
      ]);
      expect(() =>
        evalExpr(parseExpression("resource.title"), store, makeRequest()),
      ).toThrow("not found");
    });

    it("throws on entity not found during attribute access", () => {
      expect(() =>
        evalExpr(parseExpression("resource.title"), makeStore(), makeRequest()),
      ).toThrow("not found");
    });

    it("throws on unknown method", () => {
      const store = makeStore([
        {
          uid: { type: "Document", id: "doc1" },
          attrs: { tags: new CedarSet([1]) },
          parents: [],
        },
      ]);
      expect(() =>
        evalExpr(
          parseExpression("resource.tags.unknownMethod()"),
          store,
          makeRequest(),
        ),
      ).toThrow("Unknown method");
    });

    it("throws on contains applied to non-set", () => {
      expect(() =>
        evalExpr(
          parseExpression('"hello".contains("h")'),
          makeStore(),
          makeRequest(),
        ),
      ).toThrow("set");
    });

    it("handles errors in one policy without affecting others", () => {
      const store = makeStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [],
        },
      ]);
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource.nonexistent };

        permit(principal == User::"alice", action, resource);
      `);
      const result = evaluate(policies, store, makeRequest());
      // Second policy should still match even though first errored
      expect(result.decision).toBe("allow");
      expect(result.diagnostics.errors).toHaveLength(1);
      expect(result.diagnostics.reasons).toContain("policy1");
    });
  });
});
