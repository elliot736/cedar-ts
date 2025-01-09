import { describe, it, expect } from "vitest";
import { parsePolicies } from "../src/parser/parser.js";
import { validatePolicies } from "../src/schema/validator.js";
import type { CedarSchema } from "../src/schema/schema.js";

// ── Test schema ──────────────────────────────────────────────────────

const schema: CedarSchema = {
  entityTypes: {
    User: {
      shape: {
        type: "Record",
        attributes: {
          name: { type: { type: "String" } },
          age: { type: { type: "Long" } },
          active: { type: { type: "Boolean" } },
        },
      },
      memberOfTypes: ["Group"],
    },
    Group: {
      shape: {
        type: "Record",
        attributes: {
          name: { type: { type: "String" } },
        },
      },
    },
    Document: {
      shape: {
        type: "Record",
        attributes: {
          title: { type: { type: "String" } },
          isPublic: { type: { type: "Boolean" } },
          owner: { type: { type: "Entity", name: "User" } },
        },
      },
      memberOfTypes: ["Folder"],
    },
    Folder: {
      shape: {
        type: "Record",
        attributes: {
          name: { type: { type: "String" } },
        },
      },
    },
  },
  actions: {
    view: {
      appliesTo: {
        principalTypes: ["User"],
        resourceTypes: ["Document"],
      },
    },
    edit: {
      appliesTo: {
        principalTypes: ["User"],
        resourceTypes: ["Document"],
      },
    },
    delete: {
      appliesTo: {
        principalTypes: ["User"],
        resourceTypes: ["Document"],
      },
    },
  },
};

describe("schema validator", () => {
  describe("valid policies", () => {
    it("validates a correct policy", () => {
      const { policies } = parsePolicies(`
        permit(
          principal == User::"alice",
          action == Action::"view",
          resource in Folder::"shared"
        );
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates a permit-all policy", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates a policy with conditions", () => {
      const { policies } = parsePolicies(`
        permit(
          principal == User::"alice",
          action == Action::"view",
          resource
        )
        when { resource.isPublic == true };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates action in set", () => {
      const { policies } = parsePolicies(`
        permit(
          principal,
          action in [Action::"view", Action::"edit"],
          resource
        );
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates principal is Type", () => {
      const { policies } = parsePolicies(
        `permit(principal is User, action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates forbid policy", () => {
      const { policies } = parsePolicies(
        `forbid(principal, action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with has expression", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource has title };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with in expression", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { principal in Group::"admins" };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with if-then-else", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { if resource.isPublic == true then true else false };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with set and containsAll", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { [1, 2, 3].containsAll([1, 2]) };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with record literal", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { {"a": 1} == {"a": 1} };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with boolean equality", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { true == true };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with numeric comparison", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { 1 < 2 && 3 >= 3 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with principal in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal in Group::"admins", action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates policy with resource is Type in entity", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource is Document in Folder::"shared");`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });

    it("validates empty policy list", () => {
      const result = validatePolicies([], schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates multiple valid policies", () => {
      const { policies } = parsePolicies(`
        permit(principal == User::"alice", action == Action::"view", resource);
        forbid(principal, action == Action::"delete", resource);
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });
  });

  describe("unknown entity types", () => {
    it("detects unknown principal entity type", () => {
      const { policies } = parsePolicies(
        `permit(principal == Nonexistent::"x", action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Nonexistent"))).toBe(true);
    });

    it("detects unknown resource entity type", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource == Unknown::"x");`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Unknown"))).toBe(true);
    });

    it("detects unknown entity type in expression", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { principal == Ghost::"abc" };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in is constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal is Phantom, action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in resource is constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource is UnknownType);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in principal is_in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal is Unknown in Group::"admins", action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in principal in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal in FakeType::"x", action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in resource in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource in FakeType::"x");`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in is expression body", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { resource is Nonexistent };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects unknown entity type in resource is_in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource is Ghost in Folder::"x");`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects both unknown types in resource is_in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource is Ghost in FakeContainer::"x");`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("unknown actions", () => {
    it("detects unknown action", () => {
      const { policies } = parsePolicies(
        `permit(principal, action == Action::"fly", resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("fly"))).toBe(true);
    });

    it("detects unknown action in set", () => {
      const { policies } = parsePolicies(
        `permit(principal, action in [Action::"view", Action::"teleport"], resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("teleport"))).toBe(true);
    });

    it("detects unknown action in in constraint", () => {
      const { policies } = parsePolicies(
        `permit(principal, action in Action::"nonexistent", resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects all unknown actions in set", () => {
      const { policies } = parsePolicies(
        `permit(principal, action in [Action::"fly", Action::"teleport"], resource);`,
      );
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
    });
  });

  describe("attribute validation", () => {
    it("detects unknown attribute on entity literal", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { User::"alice".nonexistent == "foo" };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("nonexistent")),
      ).toBe(true);
    });

    it("accepts valid attribute on entity literal", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { User::"alice".name == "Alice" };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(true);
    });
  });

  describe("type checking", () => {
    it("detects non-boolean condition body", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { 1 + 2 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("boolean")),
      ).toBe(true);
    });

    it("detects type mismatch in && operands", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { 42 && true };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects type mismatch in || operands", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { true || 42 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects type mismatch in arithmetic", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { "hello" + 1 == 1 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects type mismatch in subtraction", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { true - 1 == 0 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects type mismatch in multiplication", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { "a" * 2 == 0 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects not applied to non-boolean", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { !42 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects negation of non-number", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { -"hello" == 1 };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects like on non-string", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { 42 like "*.txt" };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects comparison operators on non-numbers", () => {
      for (const op of ["<", "<=", ">", ">="]) {
        const { policies } = parsePolicies(`
          permit(principal, action, resource)
          when { "a" ${op} "b" };
        `);
        const result = validatePolicies(policies, schema);
        expect(result.valid).toBe(false);
      }
    });

    it("detects non-boolean if condition", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { if 42 then true else false };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects contains on non-set", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { "hello".contains("h") };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects containsAll on non-set", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { "hello".containsAll([1]) };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });

    it("detects containsAny on non-set", () => {
      const { policies } = parsePolicies(`
        permit(principal, action, resource)
        when { 42.containsAny([1]) };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
    });
  });

  describe("multiple errors", () => {
    it("reports all errors, not just the first", () => {
      const { policies } = parsePolicies(`
        permit(
          principal == Ghost::"x",
          action == Action::"fly",
          resource == Phantom::"y"
        )
        when { 42 && true };
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      // Should have errors for Ghost, fly, Phantom, and the type mismatch
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it("reports errors across multiple policies", () => {
      const { policies } = parsePolicies(`
        permit(principal == Ghost::"x", action, resource);
        permit(principal, action == Action::"fly", resource);
      `);
      const result = validatePolicies(policies, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
      // Errors should reference different policy IDs
      const policyIds = new Set(result.errors.map((e) => e.policyId));
      expect(policyIds.size).toBe(2);
    });

    it("each error includes a policy ID", () => {
      const { policies } = parsePolicies(
        `permit(principal == Ghost::"x", action, resource);`,
      );
      const result = validatePolicies(policies, schema);
      for (const err of result.errors) {
        expect(err.policyId).toBeDefined();
        expect(err.policyId).toBe("policy0");
      }
    });
  });

  describe("namespaced schema", () => {
    it("validates with namespace qualifier", () => {
      const nsSchema: CedarSchema = {
        namespace: "MyApp",
        entityTypes: {
          User: {
            shape: {
              type: "Record",
              attributes: {
                name: { type: { type: "String" } },
              },
            },
          },
        },
        actions: {
          view: {
            appliesTo: {
              principalTypes: ["User"],
              resourceTypes: ["User"],
            },
          },
        },
      };

      const { policies } = parsePolicies(
        `permit(principal == User::"alice", action == Action::"view", resource);`,
      );
      const result = validatePolicies(policies, nsSchema);
      expect(result.valid).toBe(true);
    });
  });
});
