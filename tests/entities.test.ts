import { describe, it, expect } from "vitest";
import { MemoryEntityStore } from "../src/entities/memory.js";
import { entityUIDKey } from "../src/evaluator/values.js";
import type { Entity } from "../src/entities/types.js";

describe("MemoryEntityStore", () => {
  describe("basic operations", () => {
    it("stores and retrieves entities", () => {
      const store = new MemoryEntityStore();
      const entity: Entity = {
        uid: { type: "User", id: "alice" },
        attrs: { name: "Alice" },
        parents: [],
      };
      store.add(entity);
      const retrieved = store.get({ type: "User", id: "alice" });
      expect(retrieved).toBeDefined();
      expect(retrieved!.uid).toEqual({ type: "User", id: "alice" });
      expect(retrieved!.attrs.name).toBe("Alice");
    });

    it("returns undefined for missing entities", () => {
      const store = new MemoryEntityStore();
      expect(store.get({ type: "User", id: "nonexistent" })).toBeUndefined();
    });

    it("removes entities", () => {
      const store = new MemoryEntityStore();
      store.add({
        uid: { type: "User", id: "alice" },
        attrs: {},
        parents: [],
      });
      expect(store.size).toBe(1);
      expect(store.remove({ type: "User", id: "alice" })).toBe(true);
      expect(store.size).toBe(0);
      expect(store.get({ type: "User", id: "alice" })).toBeUndefined();
    });

    it("remove returns false for missing entities", () => {
      const store = new MemoryEntityStore();
      expect(store.remove({ type: "User", id: "nonexistent" })).toBe(false);
    });

    it("reports correct size", () => {
      const store = new MemoryEntityStore([
        { uid: { type: "User", id: "alice" }, attrs: {}, parents: [] },
        { uid: { type: "User", id: "bob" }, attrs: {}, parents: [] },
      ]);
      expect(store.size).toBe(2);
    });

    it("initializes from constructor array", () => {
      const entities: Entity[] = [
        { uid: { type: "User", id: "alice" }, attrs: { age: 30 }, parents: [] },
        { uid: { type: "User", id: "bob" }, attrs: { age: 25 }, parents: [] },
      ];
      const store = new MemoryEntityStore(entities);
      expect(store.get({ type: "User", id: "alice" })!.attrs.age).toBe(30);
      expect(store.get({ type: "User", id: "bob" })!.attrs.age).toBe(25);
    });

    it("overwrites entity on re-add with same UID", () => {
      const store = new MemoryEntityStore();
      store.add({
        uid: { type: "User", id: "alice" },
        attrs: { name: "Alice v1" },
        parents: [],
      });
      store.add({
        uid: { type: "User", id: "alice" },
        attrs: { name: "Alice v2" },
        parents: [],
      });
      expect(store.size).toBe(1);
      expect(store.get({ type: "User", id: "alice" })!.attrs.name).toBe(
        "Alice v2",
      );
    });

    it("handles entities of different types with same id", () => {
      const store = new MemoryEntityStore([
        { uid: { type: "User", id: "alice" }, attrs: { kind: "user" }, parents: [] },
        { uid: { type: "Group", id: "alice" }, attrs: { kind: "group" }, parents: [] },
      ]);
      expect(store.size).toBe(2);
      expect(store.get({ type: "User", id: "alice" })!.attrs.kind).toBe("user");
      expect(store.get({ type: "Group", id: "alice" })!.attrs.kind).toBe("group");
    });
  });

  describe("ancestry computation", () => {
    it("computes direct parents", () => {
      const store = new MemoryEntityStore([
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

      const ancestors = store.getAncestors({ type: "User", id: "alice" });
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "admins" }))).toBe(true);
      expect(ancestors.size).toBe(1);
    });

    it("computes transitive ancestors", () => {
      const store = new MemoryEntityStore([
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
          parents: [{ type: "Org", id: "acme" }],
        },
        {
          uid: { type: "Org", id: "acme" },
          attrs: {},
          parents: [],
        },
      ]);

      const ancestors = store.getAncestors({ type: "User", id: "alice" });
      expect(ancestors.size).toBe(3);
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "eng" }))).toBe(true);
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "company" }))).toBe(true);
      expect(ancestors.has(entityUIDKey({ type: "Org", id: "acme" }))).toBe(true);
    });

    it("handles multiple parents (diamond hierarchy)", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [
            { type: "Group", id: "eng" },
            { type: "Group", id: "design" },
          ],
        },
        {
          uid: { type: "Group", id: "eng" },
          attrs: {},
          parents: [{ type: "Group", id: "all" }],
        },
        {
          uid: { type: "Group", id: "design" },
          attrs: {},
          parents: [{ type: "Group", id: "all" }],
        },
        {
          uid: { type: "Group", id: "all" },
          attrs: {},
          parents: [],
        },
      ]);

      const ancestors = store.getAncestors({ type: "User", id: "alice" });
      expect(ancestors.size).toBe(3);
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "eng" }))).toBe(true);
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "design" }))).toBe(true);
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "all" }))).toBe(true);
    });

    it("handles entity with no parents", () => {
      const store = new MemoryEntityStore([
        { uid: { type: "User", id: "alice" }, attrs: {}, parents: [] },
      ]);
      const ancestors = store.getAncestors({ type: "User", id: "alice" });
      expect(ancestors.size).toBe(0);
    });

    it("handles entity not in store", () => {
      const store = new MemoryEntityStore();
      const ancestors = store.getAncestors({ type: "User", id: "ghost" });
      expect(ancestors.size).toBe(0);
    });

    it("handles cycles without infinite loop", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "Group", id: "a" },
          attrs: {},
          parents: [{ type: "Group", id: "b" }],
        },
        {
          uid: { type: "Group", id: "b" },
          attrs: {},
          parents: [{ type: "Group", id: "a" }],
        },
      ]);

      // Should not hang
      const ancestors = store.getAncestors({ type: "Group", id: "a" });
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "b" }))).toBe(true);
    });

    it("handles self-referencing cycle", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "Group", id: "a" },
          attrs: {},
          parents: [{ type: "Group", id: "a" }],
        },
      ]);
      const ancestors = store.getAncestors({ type: "Group", id: "a" });
      // Self-referencing: "a" is a parent of "a", so it should appear
      expect(ancestors.has(entityUIDKey({ type: "Group", id: "a" }))).toBe(true);
    });

    it("handles 3-node cycle", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "Group", id: "a" },
          attrs: {},
          parents: [{ type: "Group", id: "b" }],
        },
        {
          uid: { type: "Group", id: "b" },
          attrs: {},
          parents: [{ type: "Group", id: "c" }],
        },
        {
          uid: { type: "Group", id: "c" },
          attrs: {},
          parents: [{ type: "Group", id: "a" }],
        },
      ]);

      const ancestors = store.getAncestors({ type: "Group", id: "a" });
      expect(ancestors.size).toBe(3); // b, c, and a (a appears as c's parent)
    });

    it("caches ancestry and invalidates on add", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "eng" }],
        },
        {
          uid: { type: "Group", id: "eng" },
          attrs: {},
          parents: [],
        },
      ]);

      const a1 = store.getAncestors({ type: "User", id: "alice" });
      expect(a1.size).toBe(1);

      // Add a parent to "eng"
      store.add({
        uid: { type: "Group", id: "eng" },
        attrs: {},
        parents: [{ type: "Group", id: "company" }],
      });
      store.add({
        uid: { type: "Group", id: "company" },
        attrs: {},
        parents: [],
      });

      const a2 = store.getAncestors({ type: "User", id: "alice" });
      expect(a2.size).toBe(2);
    });

    it("invalidates cache on remove", () => {
      const store = new MemoryEntityStore([
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

      const a1 = store.getAncestors({ type: "User", id: "alice" });
      expect(a1.size).toBe(2);

      store.remove({ type: "Group", id: "company" });
      const a2 = store.getAncestors({ type: "User", id: "alice" });
      // eng still listed as parent, but company is gone from store
      expect(a2.has(entityUIDKey({ type: "Group", id: "eng" }))).toBe(true);
      // company key is still in eng.parents but entity doesn't exist in store
      // so ancestry traversal stops there
      expect(a2.has(entityUIDKey({ type: "Group", id: "company" }))).toBe(true);
    });

    it("remove and re-add entity works correctly", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: { v: 1 },
          parents: [],
        },
      ]);
      expect(store.get({ type: "User", id: "alice" })!.attrs.v).toBe(1);

      store.remove({ type: "User", id: "alice" });
      expect(store.get({ type: "User", id: "alice" })).toBeUndefined();

      store.add({
        uid: { type: "User", id: "alice" },
        attrs: { v: 2 },
        parents: [],
      });
      expect(store.get({ type: "User", id: "alice" })!.attrs.v).toBe(2);
    });
  });

  describe("large hierarchies", () => {
    it("handles 100+ entities", () => {
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
      expect(store.size).toBe(101);

      // Every user should have "everyone" as ancestor
      for (let i = 0; i < 100; i++) {
        const ancestors = store.getAncestors({ type: "User", id: `user${i}` });
        expect(
          ancestors.has(entityUIDKey({ type: "Group", id: "everyone" })),
        ).toBe(true);
      }
    });

    it("handles deep chain of 50 entities", () => {
      const entities: Entity[] = [];
      for (let i = 0; i < 50; i++) {
        entities.push({
          uid: { type: "Group", id: `level${i}` },
          attrs: {},
          parents: i < 49 ? [{ type: "Group", id: `level${i + 1}` }] : [],
        });
      }
      const store = new MemoryEntityStore(entities);

      const ancestors = store.getAncestors({ type: "Group", id: "level0" });
      expect(ancestors.size).toBe(49);
    });
  });

  describe("concurrent modifications", () => {
    it("handles adding multiple entities rapidly", () => {
      const store = new MemoryEntityStore();
      for (let i = 0; i < 50; i++) {
        store.add({
          uid: { type: "Item", id: `item${i}` },
          attrs: { n: i },
          parents: [],
        });
      }
      expect(store.size).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(store.get({ type: "Item", id: `item${i}` })!.attrs.n).toBe(i);
      }
    });

    it("interleaved add/remove maintains consistency", () => {
      const store = new MemoryEntityStore();

      store.add({ uid: { type: "A", id: "1" }, attrs: {}, parents: [] });
      store.add({ uid: { type: "A", id: "2" }, attrs: {}, parents: [] });
      expect(store.size).toBe(2);

      store.remove({ type: "A", id: "1" });
      expect(store.size).toBe(1);

      store.add({ uid: { type: "A", id: "3" }, attrs: {}, parents: [] });
      expect(store.size).toBe(2);

      expect(store.get({ type: "A", id: "1" })).toBeUndefined();
      expect(store.get({ type: "A", id: "2" })).toBeDefined();
      expect(store.get({ type: "A", id: "3" })).toBeDefined();
    });
  });
});
