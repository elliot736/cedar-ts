import { describe, it, expect } from "vitest";
import { parsePolicies } from "../src/parser/parser.js";
import { evaluate } from "../src/evaluator/evaluator.js";
import { MemoryEntityStore } from "../src/entities/memory.js";
import type { Entity } from "../src/entities/types.js";

describe("performance and stress tests", () => {
  describe("parser stress", () => {
    it("parses 100 policies without error", () => {
      let text = "";
      for (let i = 0; i < 100; i++) {
        text += `permit(principal == User::"user${i}", action == Action::"act${i % 10}", resource);\n`;
      }
      const result = parsePolicies(text);
      expect(result.policies).toHaveLength(100);
    });

    it("parses 100 policies with conditions", () => {
      let text = "";
      for (let i = 0; i < 100; i++) {
        text += `permit(principal, action, resource)
          when { context.level >= ${i} && context.approved == true };\n`;
      }
      const result = parsePolicies(text);
      expect(result.policies).toHaveLength(100);
    });

    it("parses deeply nested arithmetic without stack overflow", () => {
      // Build: ((((1 + 1) + 1) + 1) ... + 1) — 50 levels
      let expr = "1";
      for (let i = 0; i < 50; i++) {
        expr = `(${expr} + 1)`;
      }
      const text = `permit(principal, action, resource) when { ${expr} == 51 };`;
      const result = parsePolicies(text);
      expect(result.policies).toHaveLength(1);
    });

    it("parses deeply nested boolean expressions", () => {
      let expr = "true";
      for (let i = 0; i < 30; i++) {
        expr = `(${expr} && true)`;
      }
      const text = `permit(principal, action, resource) when { ${expr} };`;
      const result = parsePolicies(text);
      expect(result.policies).toHaveLength(1);
    });
  });

  describe("evaluator stress", () => {
    it("evaluates 100 policies against a request", () => {
      let text = "";
      // 99 non-matching + 1 matching
      for (let i = 0; i < 99; i++) {
        text += `permit(principal == User::"user${i}", action, resource);\n`;
      }
      text += `permit(principal == User::"target", action, resource);\n`;

      const { policies } = parsePolicies(text);
      const store = new MemoryEntityStore();
      const result = evaluate(policies, store, {
        principal: { type: "User", id: "target" },
        action: { type: "Action", id: "view" },
        resource: { type: "Document", id: "doc1" },
        context: {},
      });
      expect(result.decision).toBe("allow");
      expect(result.diagnostics.reasons).toHaveLength(1);
    });

    it("evaluates against 100 entities in store", () => {
      const entities: Entity[] = [];
      for (let i = 0; i < 100; i++) {
        entities.push({
          uid: { type: "User", id: `user${i}` },
          attrs: { index: i },
          parents: [{ type: "Group", id: "everyone" }],
        });
      }
      entities.push({
        uid: { type: "Group", id: "everyone" },
        attrs: {},
        parents: [],
      });

      const store = new MemoryEntityStore(entities);
      const { policies } = parsePolicies(
        `permit(principal in Group::"everyone", action, resource);`,
      );

      // Test with multiple users
      for (let i = 0; i < 10; i++) {
        const result = evaluate(policies, store, {
          principal: { type: "User", id: `user${i}` },
          action: { type: "Action", id: "view" },
          resource: { type: "Document", id: "doc1" },
          context: {},
        });
        expect(result.decision).toBe("allow");
      }
    });

    it("evaluates complex policies with deep entity hierarchy", () => {
      const entities: Entity[] = [];
      // Create a 20-level hierarchy
      for (let i = 0; i < 20; i++) {
        entities.push({
          uid: { type: "Group", id: `level${i}` },
          attrs: {},
          parents: i < 19 ? [{ type: "Group", id: `level${i + 1}` }] : [],
        });
      }
      entities.push({
        uid: { type: "User", id: "deep" },
        attrs: { role: "admin" },
        parents: [{ type: "Group", id: "level0" }],
      });

      const store = new MemoryEntityStore(entities);
      const { policies } = parsePolicies(`
        permit(principal in Group::"level19", action, resource)
        when { principal.role == "admin" };
      `);

      const result = evaluate(policies, store, {
        principal: { type: "User", id: "deep" },
        action: { type: "Action", id: "view" },
        resource: { type: "Document", id: "doc1" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    it("handles many forbid policies efficiently", () => {
      let text = `permit(principal, action, resource);\n`;
      for (let i = 0; i < 50; i++) {
        text += `forbid(principal == User::"blocked${i}", action, resource);\n`;
      }

      const { policies } = parsePolicies(text);
      const store = new MemoryEntityStore();

      // Non-blocked user should be allowed
      const allowed = evaluate(policies, store, {
        principal: { type: "User", id: "safe" },
        action: { type: "Action", id: "view" },
        resource: { type: "Document", id: "doc1" },
        context: {},
      });
      expect(allowed.decision).toBe("allow");

      // Blocked user should be denied
      const denied = evaluate(policies, store, {
        principal: { type: "User", id: "blocked25" },
        action: { type: "Action", id: "view" },
        resource: { type: "Document", id: "doc1" },
        context: {},
      });
      expect(denied.decision).toBe("deny");
    });
  });

  describe("entity store stress", () => {
    it("handles rapid add/lookup cycle for 200 entities", () => {
      const store = new MemoryEntityStore();
      for (let i = 0; i < 200; i++) {
        store.add({
          uid: { type: "Item", id: `item${i}` },
          attrs: { n: i },
          parents: [],
        });
      }
      expect(store.size).toBe(200);

      for (let i = 0; i < 200; i++) {
        const e = store.get({ type: "Item", id: `item${i}` });
        expect(e).toBeDefined();
        expect(e!.attrs.n).toBe(i);
      }
    });

    it("ancestor computation on wide hierarchy (many siblings)", () => {
      const entities: Entity[] = [];
      // 100 users, all children of one group
      for (let i = 0; i < 100; i++) {
        entities.push({
          uid: { type: "User", id: `u${i}` },
          attrs: {},
          parents: [{ type: "Group", id: "shared" }],
        });
      }
      entities.push({
        uid: { type: "Group", id: "shared" },
        attrs: {},
        parents: [],
      });

      const store = new MemoryEntityStore(entities);
      // Each user's ancestors should be just { shared }
      for (let i = 0; i < 100; i++) {
        const anc = store.getAncestors({ type: "User", id: `u${i}` });
        expect(anc.size).toBe(1);
      }
    });
  });
});
