import { describe, it, expect } from "vitest";
import { Authorizer } from "../src/authorizer.js";
import { MemoryEntityStore } from "../src/entities/memory.js";
import { parsePolicies } from "../src/parser/parser.js";
import type { Request } from "../src/evaluator/context.js";

describe("Authorizer", () => {
  // ── Multi-tenant SaaS scenario ───────────────────────────────────

  describe("multi-tenant SaaS", () => {
    const store = new MemoryEntityStore([
      // Tenant structure
      {
        uid: { type: "Tenant", id: "acme" },
        attrs: { plan: "enterprise" },
        parents: [],
      },
      {
        uid: { type: "Tenant", id: "initech" },
        attrs: { plan: "free" },
        parents: [],
      },

      // Users
      {
        uid: { type: "User", id: "alice" },
        attrs: { name: "Alice", role: "admin" },
        parents: [
          { type: "Team", id: "acme-eng" },
          { type: "Tenant", id: "acme" },
        ],
      },
      {
        uid: { type: "User", id: "bob" },
        attrs: { name: "Bob", role: "viewer" },
        parents: [
          { type: "Team", id: "acme-eng" },
          { type: "Tenant", id: "acme" },
        ],
      },
      {
        uid: { type: "User", id: "carol" },
        attrs: { name: "Carol", role: "admin" },
        parents: [{ type: "Tenant", id: "initech" }],
      },
      {
        uid: { type: "User", id: "dave" },
        attrs: { name: "Dave", role: "editor" },
        parents: [
          { type: "Team", id: "acme-eng" },
          { type: "Tenant", id: "acme" },
        ],
      },
      {
        uid: { type: "User", id: "eve" },
        attrs: { name: "Eve", role: "viewer", suspended: true },
        parents: [{ type: "Tenant", id: "acme" }],
      },

      // Teams
      {
        uid: { type: "Team", id: "acme-eng" },
        attrs: {},
        parents: [{ type: "Tenant", id: "acme" }],
      },

      // Resources
      {
        uid: { type: "Document", id: "acme-roadmap" },
        attrs: {
          title: "Acme Roadmap",
          isPublic: false,
          classification: "internal",
        },
        parents: [
          { type: "Folder", id: "acme-docs" },
          { type: "Tenant", id: "acme" },
        ],
      },
      {
        uid: { type: "Document", id: "acme-blog" },
        attrs: {
          title: "Acme Blog Post",
          isPublic: true,
          classification: "public",
        },
        parents: [
          { type: "Folder", id: "acme-docs" },
          { type: "Tenant", id: "acme" },
        ],
      },
      {
        uid: { type: "Document", id: "acme-secret" },
        attrs: {
          title: "Secret Plan",
          isPublic: false,
          classification: "top-secret",
        },
        parents: [
          { type: "Folder", id: "acme-docs" },
          { type: "Tenant", id: "acme" },
        ],
      },
      {
        uid: { type: "Folder", id: "acme-docs" },
        attrs: {},
        parents: [{ type: "Tenant", id: "acme" }],
      },

      // Actions hierarchy
      {
        uid: { type: "Action", id: "read" },
        attrs: {},
        parents: [{ type: "Action", id: "readOnly" }],
      },
      {
        uid: { type: "Action", id: "write" },
        attrs: {},
        parents: [],
      },
      {
        uid: { type: "Action", id: "delete" },
        attrs: {},
        parents: [],
      },
      {
        uid: { type: "Action", id: "readOnly" },
        attrs: {},
        parents: [],
      },
    ]);

    const policyText = `
      // Policy 1: Admins in a tenant can do anything to resources in that tenant
      permit(
        principal,
        action,
        resource in Tenant::"acme"
      )
      when { principal in Tenant::"acme" && principal.role == "admin" };

      // Policy 2: Anyone in acme can read public documents
      permit(
        principal in Tenant::"acme",
        action == Action::"read",
        resource in Tenant::"acme"
      )
      when { resource.isPublic == true };

      // Policy 3: Viewers can only read
      permit(
        principal in Tenant::"acme",
        action in Action::"readOnly",
        resource in Tenant::"acme"
      )
      when { principal.role == "viewer" };

      // Policy 4: Forbid deleting internal documents
      forbid(
        principal,
        action == Action::"delete",
        resource
      )
      when { resource has classification && resource.classification == "internal" };

      // Policy 5: Editors can write
      permit(
        principal in Tenant::"acme",
        action == Action::"write",
        resource in Tenant::"acme"
      )
      when { principal.role == "editor" };

      // Policy 6: Forbid all actions for suspended users
      forbid(
        principal,
        action,
        resource
      )
      when { principal has suspended && principal.suspended == true };

      // Policy 7: Forbid deleting top-secret docs
      forbid(
        principal,
        action == Action::"delete",
        resource
      )
      when { resource has classification && resource.classification == "top-secret" };
    `;

    const authorizer = Authorizer.fromText(policyText, store);

    // Scenario 1: Admin write
    it("allows admin to write to tenant resource", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "write" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 2: Viewer write denied
    it("denies viewer from writing", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "bob" },
        action: { type: "Action", id: "write" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 3: Viewer read allowed
    it("allows viewer to read (via action hierarchy)", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "bob" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 4: Public document read
    it("allows anyone in acme to read public documents", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "bob" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 5: Cross-tenant denied
    it("denies user from another tenant", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "carol" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 6: Forbid overrides permit for internal docs
    it("forbid overrides permit: cannot delete internal docs even as admin", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "delete" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 7: Admin can delete non-internal docs
    it("admin can delete non-internal (public) docs", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "delete" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 8: Editor can write
    it("allows editor to write", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "dave" },
        action: { type: "Action", id: "write" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 9: Editor cannot delete
    it("denies editor from deleting", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "dave" },
        action: { type: "Action", id: "delete" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      // dave is not admin, and even if some permit matched, forbid for internal docs kicks in
      expect(result.decision).toBe("deny");
    });

    // Scenario 10: Suspended user denied everything
    it("denies suspended user from any action", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "eve" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 11: Admin cannot delete top-secret docs
    it("forbid prevents admin from deleting top-secret docs", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "delete" },
        resource: { type: "Document", id: "acme-secret" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 12: Admin can read top-secret docs
    it("admin can read top-secret docs (only delete is forbidden)", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-secret" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 13: Cross-tenant admin cannot access other tenant
    it("initech admin cannot read acme docs", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "carol" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 14: Viewer cannot write
    it("viewer cannot write to any doc", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "bob" },
        action: { type: "Action", id: "write" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 15: Unknown user denied
    it("unknown user is denied by default", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "unknown" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 16: Unknown resource denied
    it("request for unknown resource is denied", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "nonexistent" },
        context: {},
      });
      expect(result.decision).toBe("deny");
    });

    // Scenario 17: Unknown action still matched by wildcard policy
    it("request with unknown action is allowed for admin (wildcard policy)", () => {
      // Policy 1 has action = any, so any action matches for admins in acme
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "unknown-action" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 18: Admin read on public doc
    it("admin can read public docs", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    // Scenario 19: Editor read
    it("editor can read via viewer-like policies", () => {
      // dave is editor, not viewer - but admin policy #1 doesn't match (not admin)
      // viewer policy #3 doesn't match (not viewer)
      // public doc policy #2 only applies to public docs
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "dave" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-blog" },
        context: {},
      });
      // Policy 2 matches: dave is in acme, action is read, acme-blog is public
      expect(result.decision).toBe("allow");
    });

    // Scenario 20: Editor reading non-public doc
    it("editor cannot read non-public doc (no viewer role)", () => {
      const result = authorizer.isAuthorized({
        principal: { type: "User", id: "dave" },
        action: { type: "Action", id: "read" },
        resource: { type: "Document", id: "acme-roadmap" },
        context: {},
      });
      // dave is editor, not admin or viewer - no policy grants read for non-public docs
      expect(result.decision).toBe("deny");
    });
  });

  // ── API tests ────────────────────────────────────────────────────

  describe("Authorizer API", () => {
    it("creates from text", () => {
      const store = new MemoryEntityStore();
      const auth = Authorizer.fromText(
        `permit(principal, action, resource);`,
        store,
      );
      const result = auth.isAuthorized({
        principal: { type: "User", id: "test" },
        action: { type: "Action", id: "test" },
        resource: { type: "Resource", id: "test" },
        context: {},
      });
      expect(result.decision).toBe("allow");
    });

    it("creates from parsed policies", () => {
      const { policies } = parsePolicies(
        `permit(principal, action, resource);`,
      );
      const auth = new Authorizer(policies, new MemoryEntityStore());
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "x" },
          action: { type: "Action", id: "y" },
          resource: { type: "Resource", id: "z" },
          context: {},
        }).decision,
      ).toBe("allow");
    });

    it("adds policies at runtime", () => {
      const store = new MemoryEntityStore();
      const auth = new Authorizer([], store);

      // No policies -> deny
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "x" },
          action: { type: "Action", id: "y" },
          resource: { type: "Resource", id: "z" },
          context: {},
        }).decision,
      ).toBe("deny");

      // Add a permit-all
      auth.addPoliciesFromText(`permit(principal, action, resource);`);
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "x" },
          action: { type: "Action", id: "y" },
          resource: { type: "Resource", id: "z" },
          context: {},
        }).decision,
      ).toBe("allow");
    });

    it("adds pre-parsed policies at runtime", () => {
      const auth = new Authorizer([], new MemoryEntityStore());
      const { policies } = parsePolicies(
        `permit(principal, action, resource);`,
      );
      auth.addPolicies(policies);
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "x" },
          action: { type: "Action", id: "y" },
          resource: { type: "Resource", id: "z" },
          context: {},
        }).decision,
      ).toBe("allow");
    });

    it("replaces entity store", () => {
      const store1 = new MemoryEntityStore([
        {
          uid: { type: "User", id: "alice" },
          attrs: {},
          parents: [{ type: "Group", id: "admins" }],
        },
        { uid: { type: "Group", id: "admins" }, attrs: {}, parents: [] },
      ]);

      const auth = Authorizer.fromText(
        `permit(principal in Group::"admins", action, resource);`,
        store1,
      );

      const req: Request = {
        principal: { type: "User", id: "alice" },
        action: { type: "Action", id: "test" },
        resource: { type: "Resource", id: "test" },
        context: {},
      };

      expect(auth.isAuthorized(req).decision).toBe("allow");

      // Replace with an empty store
      auth.setEntityStore(new MemoryEntityStore());
      expect(auth.isAuthorized(req).decision).toBe("deny");
    });

    it("returns diagnostics with policy IDs", () => {
      const auth = Authorizer.fromText(
        `permit(principal, action, resource);`,
        new MemoryEntityStore(),
      );
      const result = auth.isAuthorized({
        principal: { type: "User", id: "x" },
        action: { type: "Action", id: "y" },
        resource: { type: "Resource", id: "z" },
        context: {},
      });
      expect(result.diagnostics.reasons).toHaveLength(1);
      expect(result.diagnostics.reasons[0]).toBe("policy0");
    });

    it("getPolicies returns current policies", () => {
      const auth = Authorizer.fromText(
        `permit(principal, action, resource);
         forbid(principal, action, resource);`,
        new MemoryEntityStore(),
      );
      expect(auth.getPolicies()).toHaveLength(2);
    });
  });

  // ── Context-heavy scenario ───────────────────────────────────────

  describe("context-based authorization", () => {
    it("evaluates complex context conditions", () => {
      const store = new MemoryEntityStore([
        {
          uid: { type: "Account", id: "acct1" },
          attrs: { balance: 5000, currency: "USD" },
          parents: [],
        },
      ]);

      const auth = Authorizer.fromText(
        `
        permit(principal, action == Action::"transfer", resource)
        when {
          context.amount < 1000 &&
          context.currency == "USD"
        };

        forbid(principal, action == Action::"transfer", resource)
        when {
          context.amount >= 10000
        };
        `,
        store,
      );

      // Small transfer: allowed
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "alice" },
          action: { type: "Action", id: "transfer" },
          resource: { type: "Account", id: "acct1" },
          context: { amount: 500, currency: "USD" },
        }).decision,
      ).toBe("allow");

      // Large transfer under 10k: denied (no permit matches > 1000)
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "alice" },
          action: { type: "Action", id: "transfer" },
          resource: { type: "Account", id: "acct1" },
          context: { amount: 5000, currency: "USD" },
        }).decision,
      ).toBe("deny");

      // Wrong currency: denied
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "alice" },
          action: { type: "Action", id: "transfer" },
          resource: { type: "Account", id: "acct1" },
          context: { amount: 100, currency: "EUR" },
        }).decision,
      ).toBe("deny");

      // Very large transfer: explicitly forbidden
      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "alice" },
          action: { type: "Action", id: "transfer" },
          resource: { type: "Account", id: "acct1" },
          context: { amount: 50000, currency: "USD" },
        }).decision,
      ).toBe("deny");
    });
  });

  // ── Time-of-day / IP-based scenario ─────────────────────────────

  describe("context attributes for realistic conditions", () => {
    it("allows based on time-of-day context", () => {
      const auth = Authorizer.fromText(
        `
        permit(principal, action, resource)
        when { context.hour >= 9 && context.hour < 17 };
        `,
        new MemoryEntityStore(),
      );

      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "alice" },
          action: { type: "Action", id: "work" },
          resource: { type: "Resource", id: "r1" },
          context: { hour: 12 },
        }).decision,
      ).toBe("allow");

      expect(
        auth.isAuthorized({
          principal: { type: "User", id: "alice" },
          action: { type: "Action", id: "work" },
          resource: { type: "Resource", id: "r1" },
          context: { hour: 22 },
        }).decision,
      ).toBe("deny");
    });
  });
});
