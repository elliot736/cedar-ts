import { describe, it, expect } from "vitest";
import { parsePolicies, parseExpression } from "../src/parser/parser.js";

describe("parser", () => {
  describe("basic policies", () => {
    it("parses a simple permit-all policy", () => {
      const result = parsePolicies(`permit(principal, action, resource);`);
      expect(result.policies).toHaveLength(1);
      const p = result.policies[0]!;
      expect(p.effect).toBe("permit");
      expect(p.principal).toEqual({ kind: "any" });
      expect(p.action).toEqual({ kind: "any" });
      expect(p.resource).toEqual({ kind: "any" });
      expect(p.conditions).toHaveLength(0);
    });

    it("parses a forbid-all policy", () => {
      const result = parsePolicies(`forbid(principal, action, resource);`);
      expect(result.policies).toHaveLength(1);
      expect(result.policies[0]!.effect).toBe("forbid");
    });

    it("parses multiple policies", () => {
      const result = parsePolicies(`
        permit(principal, action, resource);
        forbid(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(2);
      expect(result.policies[0]!.effect).toBe("permit");
      expect(result.policies[1]!.effect).toBe("forbid");
    });

    it("parses an empty policy set", () => {
      const result = parsePolicies("");
      expect(result.policies).toHaveLength(0);
    });

    it("parses a policy set with only whitespace", () => {
      const result = parsePolicies("   \n\n  \t  ");
      expect(result.policies).toHaveLength(0);
    });

    it("assigns sequential policy IDs", () => {
      const result = parsePolicies(`
        permit(principal, action, resource);
        forbid(principal, action, resource);
        permit(principal, action, resource);
      `);
      expect(result.policies[0]!.id).toBe("policy0");
      expect(result.policies[1]!.id).toBe("policy1");
      expect(result.policies[2]!.id).toBe("policy2");
    });
  });

  describe("scope constraints", () => {
    it("parses principal == entity", () => {
      const result = parsePolicies(
        `permit(principal == User::"alice", action, resource);`,
      );
      const p = result.policies[0]!;
      expect(p.principal).toEqual({
        kind: "eq",
        entity: expect.objectContaining({ type: "User", id: "alice" }),
      });
    });

    it("parses principal in entity", () => {
      const result = parsePolicies(
        `permit(principal in Group::"admins", action, resource);`,
      );
      const p = result.policies[0]!;
      expect(p.principal).toEqual({
        kind: "in",
        entity: expect.objectContaining({ type: "Group", id: "admins" }),
      });
    });

    it("parses principal is Type", () => {
      const result = parsePolicies(
        `permit(principal is User, action, resource);`,
      );
      const p = result.policies[0]!;
      expect(p.principal).toEqual({ kind: "is", entityType: "User" });
    });

    it("parses principal is Type in entity", () => {
      const result = parsePolicies(
        `permit(principal is User in Group::"admins", action, resource);`,
      );
      const p = result.policies[0]!;
      expect(p.principal).toEqual({
        kind: "is_in",
        entityType: "User",
        entity: expect.objectContaining({ type: "Group", id: "admins" }),
      });
    });

    it("parses action == entity", () => {
      const result = parsePolicies(
        `permit(principal, action == Action::"view", resource);`,
      );
      expect(result.policies[0]!.action).toEqual({
        kind: "eq",
        entity: expect.objectContaining({ type: "Action", id: "view" }),
      });
    });

    it("parses action in set", () => {
      const result = parsePolicies(
        `permit(principal, action in [Action::"view", Action::"edit"], resource);`,
      );
      const a = result.policies[0]!.action;
      expect(a.kind).toBe("in_set");
      if (a.kind === "in_set") {
        expect(a.entities).toHaveLength(2);
        expect(a.entities[0]).toMatchObject({ type: "Action", id: "view" });
        expect(a.entities[1]).toMatchObject({ type: "Action", id: "edit" });
      }
    });

    it("parses action in single entity", () => {
      const result = parsePolicies(
        `permit(principal, action in Action::"readOnly", resource);`,
      );
      expect(result.policies[0]!.action).toEqual({
        kind: "in",
        entity: expect.objectContaining({ type: "Action", id: "readOnly" }),
      });
    });

    it("parses resource == entity", () => {
      const result = parsePolicies(
        `permit(principal, action, resource == Document::"doc1");`,
      );
      expect(result.policies[0]!.resource).toEqual({
        kind: "eq",
        entity: expect.objectContaining({ type: "Document", id: "doc1" }),
      });
    });

    it("parses resource in entity", () => {
      const result = parsePolicies(
        `permit(principal, action, resource in Folder::"root");`,
      );
      expect(result.policies[0]!.resource).toEqual({
        kind: "in",
        entity: expect.objectContaining({ type: "Folder", id: "root" }),
      });
    });

    it("parses resource is Type", () => {
      const result = parsePolicies(
        `permit(principal, action, resource is Document);`,
      );
      expect(result.policies[0]!.resource).toEqual({
        kind: "is",
        entityType: "Document",
      });
    });

    it("parses resource is Type in entity", () => {
      const result = parsePolicies(
        `permit(principal, action, resource is Document in Folder::"shared");`,
      );
      expect(result.policies[0]!.resource).toEqual({
        kind: "is_in",
        entityType: "Document",
        entity: expect.objectContaining({ type: "Folder", id: "shared" }),
      });
    });

    it("parses namespaced entity types", () => {
      const result = parsePolicies(
        `permit(principal == MyApp::User::"alice", action, resource);`,
      );
      const p = result.policies[0]!;
      expect(p.principal).toEqual({
        kind: "eq",
        entity: expect.objectContaining({ type: "MyApp::User", id: "alice" }),
      });
    });

    it("parses deeply namespaced entity types", () => {
      const result = parsePolicies(
        `permit(principal == Org::Dept::Team::User::"alice", action, resource);`,
      );
      const p = result.policies[0]!;
      expect(p.principal).toEqual({
        kind: "eq",
        entity: expect.objectContaining({
          type: "Org::Dept::Team::User",
          id: "alice",
        }),
      });
    });

    it("parses action in empty set", () => {
      const result = parsePolicies(
        `permit(principal, action in [], resource);`,
      );
      const a = result.policies[0]!.action;
      expect(a.kind).toBe("in_set");
      if (a.kind === "in_set") {
        expect(a.entities).toHaveLength(0);
      }
    });
  });

  describe("conditions", () => {
    it("parses a when condition", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        when { true };
      `);
      const p = result.policies[0]!;
      expect(p.conditions).toHaveLength(1);
      expect(p.conditions[0]!.kind).toBe("when");
      expect(p.conditions[0]!.body).toEqual(
        expect.objectContaining({ kind: "literal", value: true }),
      );
    });

    it("parses an unless condition", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        unless { false };
      `);
      const p = result.policies[0]!;
      expect(p.conditions).toHaveLength(1);
      expect(p.conditions[0]!.kind).toBe("unless");
    });

    it("parses multiple conditions", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        when { true }
        unless { false };
      `);
      expect(result.policies[0]!.conditions).toHaveLength(2);
    });

    it("parses multiple when conditions", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        when { true }
        when { 1 == 1 };
      `);
      expect(result.policies[0]!.conditions).toHaveLength(2);
      expect(result.policies[0]!.conditions[0]!.kind).toBe("when");
      expect(result.policies[0]!.conditions[1]!.kind).toBe("when");
    });

    it("parses complex condition expressions", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        when { context.role == "admin" && resource.isPublic == true }
        unless { context.suspended == true };
      `);
      const conds = result.policies[0]!.conditions;
      expect(conds).toHaveLength(2);
      expect(conds[0]!.body.kind).toBe("binary");
      expect(conds[1]!.body.kind).toBe("binary");
    });
  });

  describe("expressions", () => {
    it("parses boolean literals", () => {
      const expr = parseExpression("true");
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: true }));
    });

    it("parses false literal", () => {
      const expr = parseExpression("false");
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: false }));
    });

    it("parses number literals", () => {
      const expr = parseExpression("42");
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: 42 }));
    });

    it("parses zero", () => {
      const expr = parseExpression("0");
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: 0 }));
    });

    it("parses large numbers", () => {
      const expr = parseExpression("999999");
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: 999999 }));
    });

    it("parses string literals", () => {
      const expr = parseExpression('"hello"');
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: "hello" }));
    });

    it("parses empty string", () => {
      const expr = parseExpression('""');
      expect(expr).toEqual(expect.objectContaining({ kind: "literal", value: "" }));
    });

    it("parses string with escape sequences", () => {
      const expr = parseExpression('"hello\\nworld"');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "literal", value: "hello\nworld" }),
      );
    });

    it("parses string with tab escape", () => {
      const expr = parseExpression('"col1\\tcol2"');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "literal", value: "col1\tcol2" }),
      );
    });

    it("parses string with escaped backslash", () => {
      const expr = parseExpression('"path\\\\file"');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "literal", value: "path\\file" }),
      );
    });

    it("parses string with escaped quote", () => {
      const expr = parseExpression('"say \\"hello\\""');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "literal", value: 'say "hello"' }),
      );
    });

    it("parses string with unicode characters", () => {
      const expr = parseExpression('"hello world"');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "literal", value: "hello world" }),
      );
    });

    it("parses entity UIDs", () => {
      const expr = parseExpression('User::"alice"');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "entity_uid", type: "User", id: "alice" }),
      );
    });

    it("parses variables", () => {
      for (const v of ["principal", "action", "resource", "context"]) {
        const expr = parseExpression(v);
        expect(expr).toEqual(expect.objectContaining({ kind: "var", name: v }));
      }
    });

    it("parses negation", () => {
      const expr = parseExpression("-5");
      expect(expr.kind).toBe("neg");
      if (expr.kind === "neg") {
        expect(expr.operand).toEqual(
          expect.objectContaining({ kind: "literal", value: 5 }),
        );
      }
    });

    it("parses double negation", () => {
      const expr = parseExpression("--5");
      expect(expr.kind).toBe("neg");
      if (expr.kind === "neg") {
        expect(expr.operand.kind).toBe("neg");
      }
    });

    it("parses not", () => {
      const expr = parseExpression("!true");
      expect(expr.kind).toBe("not");
    });

    it("parses double not", () => {
      const expr = parseExpression("!!true");
      expect(expr.kind).toBe("not");
      if (expr.kind === "not") {
        expect(expr.operand.kind).toBe("not");
      }
    });

    it("parses equality", () => {
      const expr = parseExpression("1 == 2");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "binary", op: "==" }),
      );
    });

    it("parses inequality", () => {
      const expr = parseExpression("1 != 2");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "binary", op: "!=" }),
      );
    });

    it("parses all comparison operators", () => {
      for (const op of ["<", ">", "<=", ">="]) {
        const expr = parseExpression(`1 ${op} 2`);
        expect(expr).toEqual(
          expect.objectContaining({ kind: "binary", op }),
        );
      }
    });

    it("parses && and ||", () => {
      const expr = parseExpression("true && false || true");
      // || has lower precedence, so top-level is ||
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("||");
        expect(expr.left).toEqual(
          expect.objectContaining({ kind: "binary", op: "&&" }),
        );
      }
    });

    it("parses chained && with correct associativity", () => {
      const expr = parseExpression("true && false && true");
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("&&");
        expect(expr.left.kind).toBe("binary");
      }
    });

    it("parses chained || with correct associativity", () => {
      const expr = parseExpression("true || false || true");
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("||");
        expect(expr.left.kind).toBe("binary");
      }
    });

    it("parses arithmetic", () => {
      const expr = parseExpression("1 + 2 * 3");
      // * has higher precedence
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("+");
        expect(expr.right).toEqual(
          expect.objectContaining({ kind: "binary", op: "*" }),
        );
      }
    });

    it("parses subtraction", () => {
      const expr = parseExpression("10 - 3");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "binary", op: "-" }),
      );
    });

    it("parses chained addition", () => {
      const expr = parseExpression("1 + 2 + 3");
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("+");
        expect(expr.left.kind).toBe("binary");
      }
    });

    it("parses if-then-else", () => {
      const expr = parseExpression("if true then 1 else 2");
      expect(expr.kind).toBe("if_then_else");
      if (expr.kind === "if_then_else") {
        expect(expr.cond).toEqual(
          expect.objectContaining({ kind: "literal", value: true }),
        );
        expect(expr.then).toEqual(
          expect.objectContaining({ kind: "literal", value: 1 }),
        );
        expect(expr.else_).toEqual(
          expect.objectContaining({ kind: "literal", value: 2 }),
        );
      }
    });

    it("parses nested if-then-else", () => {
      const expr = parseExpression(
        "if true then if false then 1 else 2 else 3",
      );
      expect(expr.kind).toBe("if_then_else");
      if (expr.kind === "if_then_else") {
        expect(expr.then.kind).toBe("if_then_else");
      }
    });

    it("parses has operator", () => {
      const expr = parseExpression("resource has name");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "has", attr: "name" }),
      );
    });

    it("parses has with string attribute", () => {
      const expr = parseExpression('resource has "special-key"');
      expect(expr).toEqual(
        expect.objectContaining({ kind: "has", attr: "special-key" }),
      );
    });

    it("parses in operator", () => {
      const expr = parseExpression('principal in Group::"admins"');
      expect(expr.kind).toBe("in");
    });

    it("parses like operator", () => {
      const expr = parseExpression('resource.name like "*.txt"');
      expect(expr.kind).toBe("like");
      if (expr.kind === "like") {
        expect(expr.pattern).toBe("*.txt");
      }
    });

    it("parses is operator in expression", () => {
      const expr = parseExpression("resource is Document");
      expect(expr.kind).toBe("is");
      if (expr.kind === "is") {
        expect(expr.entityType).toBe("Document");
      }
    });

    it("parses is ... in expression", () => {
      const expr = parseExpression('resource is Document in Folder::"shared"');
      expect(expr.kind).toBe("is");
      if (expr.kind === "is") {
        expect(expr.entityType).toBe("Document");
        expect(expr.inExpr).toBeDefined();
      }
    });

    it("parses member access", () => {
      const expr = parseExpression("resource.name");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "get_attr", attr: "name" }),
      );
    });

    it("parses chained member access", () => {
      const expr = parseExpression("resource.owner.name");
      expect(expr.kind).toBe("get_attr");
      if (expr.kind === "get_attr") {
        expect(expr.attr).toBe("name");
        expect(expr.left).toEqual(
          expect.objectContaining({ kind: "get_attr", attr: "owner" }),
        );
      }
    });

    it("parses deeply chained member access", () => {
      const expr = parseExpression("context.a.b.c.d");
      expect(expr.kind).toBe("get_attr");
      if (expr.kind === "get_attr") {
        expect(expr.attr).toBe("d");
      }
    });

    it("parses bracket access", () => {
      const expr = parseExpression('context["special-key"]');
      expect(expr.kind).toBe("get_attr");
      if (expr.kind === "get_attr") {
        expect(expr.attr).toBe("special-key");
      }
    });

    it("parses method calls", () => {
      const expr = parseExpression("resource.tags.contains(1)");
      expect(expr.kind).toBe("method_call");
      if (expr.kind === "method_call") {
        expect(expr.method).toBe("contains");
        expect(expr.args).toHaveLength(1);
      }
    });

    it("parses method calls with multiple arguments", () => {
      // While Cedar methods typically take one arg, the parser accepts multiple
      const expr = parseExpression("resource.tags.contains(1)");
      expect(expr.kind).toBe("method_call");
    });

    it("parses containsAll and containsAny", () => {
      const expr1 = parseExpression("resource.tags.containsAll([1, 2])");
      expect(expr1.kind).toBe("method_call");
      if (expr1.kind === "method_call") {
        expect(expr1.method).toBe("containsAll");
      }

      const expr2 = parseExpression("resource.tags.containsAny([3, 4])");
      expect(expr2.kind).toBe("method_call");
      if (expr2.kind === "method_call") {
        expect(expr2.method).toBe("containsAny");
      }
    });

    it("parses set literals", () => {
      const expr = parseExpression("[1, 2, 3]");
      expect(expr.kind).toBe("set");
      if (expr.kind === "set") {
        expect(expr.elements).toHaveLength(3);
      }
    });

    it("parses empty set", () => {
      const expr = parseExpression("[]");
      expect(expr.kind).toBe("set");
      if (expr.kind === "set") {
        expect(expr.elements).toHaveLength(0);
      }
    });

    it("parses nested sets", () => {
      const expr = parseExpression("[[1, 2], [3, 4]]");
      expect(expr.kind).toBe("set");
      if (expr.kind === "set") {
        expect(expr.elements).toHaveLength(2);
        expect(expr.elements[0]!.kind).toBe("set");
      }
    });

    it("parses record literals", () => {
      const expr = parseExpression('{"key": "value", "num": 42}');
      expect(expr.kind).toBe("record");
      if (expr.kind === "record") {
        expect(expr.pairs).toHaveLength(2);
      }
    });

    it("parses empty record", () => {
      const expr = parseExpression("{}");
      expect(expr.kind).toBe("record");
      if (expr.kind === "record") {
        expect(expr.pairs).toHaveLength(0);
      }
    });

    it("parses record with identifier keys", () => {
      const expr = parseExpression("{name: \"alice\", age: 30}");
      expect(expr.kind).toBe("record");
      if (expr.kind === "record") {
        expect(expr.pairs).toHaveLength(2);
        expect(expr.pairs[0]!.key).toBe("name");
        expect(expr.pairs[1]!.key).toBe("age");
      }
    });

    it("parses parenthesized expressions", () => {
      const expr = parseExpression("(1 + 2) * 3");
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("*");
      }
    });

    it("parses nested parentheses", () => {
      const expr = parseExpression("((1 + 2))");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "binary", op: "+" }),
      );
    });

    it("parses complex nested expression", () => {
      const expr = parseExpression(
        '(1 + 2) * 3 == 9 && "hello" != "world"',
      );
      expect(expr.kind).toBe("binary");
      if (expr.kind === "binary") {
        expect(expr.op).toBe("&&");
      }
    });
  });

  describe("deeply nested expressions", () => {
    it("parses 10 levels of nested parentheses", () => {
      const expr = parseExpression("((((((((((42))))))))))");
      expect(expr).toEqual(
        expect.objectContaining({ kind: "literal", value: 42 }),
      );
    });

    it("parses deeply nested boolean expressions", () => {
      const expr = parseExpression(
        "true && (false || (true && (false || true)))",
      );
      expect(expr.kind).toBe("binary");
    });

    it("parses chained comparisons with parentheses", () => {
      const expr = parseExpression("(1 < 2) && (3 > 2) && (4 >= 4)");
      expect(expr.kind).toBe("binary");
    });

    it("parses nested if-then-else in condition", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        when { if true then if false then false else true else false };
      `);
      expect(result.policies).toHaveLength(1);
    });
  });

  describe("multiline policies", () => {
    it("parses a policy spanning many lines", () => {
      const result = parsePolicies(`
        permit(
          principal
            in
              Group::"admins",
          action
            ==
              Action::"editDocument",
          resource
            in
              Folder::"shared"
        )
        when {
          resource.isPublished
            ==
              true
        }
        unless {
          resource has isArchived
            &&
              resource.isArchived
        };
      `);
      const p = result.policies[0]!;
      expect(p.effect).toBe("permit");
      expect(p.conditions).toHaveLength(2);
    });
  });

  describe("comments", () => {
    it("ignores line comments", () => {
      const result = parsePolicies(`
        // This is a comment
        permit(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(1);
    });

    it("ignores block comments", () => {
      const result = parsePolicies(`
        /* Block comment */
        permit(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(1);
    });

    it("ignores inline comments", () => {
      const result = parsePolicies(`
        permit(principal, action, resource) // inline comment
        when { true }; // another comment
      `);
      expect(result.policies).toHaveLength(1);
    });

    it("ignores multi-line block comments", () => {
      const result = parsePolicies(`
        /*
         * Multi-line
         * block comment
         */
        permit(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(1);
    });

    it("ignores comments between policies", () => {
      const result = parsePolicies(`
        permit(principal, action, resource);
        // separator
        forbid(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(2);
    });
  });

  describe("annotations", () => {
    it("skips annotations on policies", () => {
      const result = parsePolicies(`
        @id("policy1")
        permit(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(1);
    });

    it("skips multiple annotations", () => {
      const result = parsePolicies(`
        @id("policy1")
        @description("A test policy")
        permit(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(1);
    });

    it("skips annotations with various string values", () => {
      const result = parsePolicies(`
        @id("my-policy-123")
        @advice("Contact admin if denied")
        permit(principal, action, resource);
      `);
      expect(result.policies).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("reports error on unexpected token", () => {
      expect(() => parsePolicies("invalid;")).toThrow();
    });

    it("reports error on unterminated string", () => {
      expect(() => parsePolicies('"unterminated')).toThrow();
    });

    it("reports error on missing semicolon", () => {
      expect(() =>
        parsePolicies("permit(principal, action, resource)"),
      ).toThrow();
    });

    it("reports error on missing closing paren", () => {
      expect(() =>
        parsePolicies("permit(principal, action, resource;"),
      ).toThrow();
    });

    it("throws ParseError with position info", () => {
      try {
        parsePolicies("invalid;");
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain("line");
      }
    });

    it("reports error on missing comma between scope elements", () => {
      expect(() =>
        parsePolicies("permit(principal action resource);"),
      ).toThrow();
    });

    it("reports error on missing condition body braces", () => {
      expect(() =>
        parsePolicies("permit(principal, action, resource) when true;"),
      ).toThrow();
    });

    it("reports error on unexpected character", () => {
      expect(() => parsePolicies("permit(principal, action, resource) #;")).toThrow();
    });

    it("reports error for permit with no arguments", () => {
      expect(() => parsePolicies("permit();")).toThrow();
    });

    it("reports error for missing effect keyword", () => {
      expect(() => parsePolicies("(principal, action, resource);")).toThrow();
    });

    it("reports error on entity UID missing string", () => {
      expect(() => parseExpression("User::123")).toThrow();
    });
  });

  describe("complex policies", () => {
    it("parses a real-world RBAC policy", () => {
      const result = parsePolicies(`
        permit(
          principal in Group::"admins",
          action == Action::"editDocument",
          resource in Folder::"shared"
        )
        when { resource.isPublished == true }
        unless { resource has isArchived && resource.isArchived };
      `);
      const p = result.policies[0]!;
      expect(p.effect).toBe("permit");
      expect(p.conditions).toHaveLength(2);
    });

    it("parses a context-based policy", () => {
      const result = parsePolicies(`
        permit(
          principal,
          action == Action::"transfer",
          resource
        )
        when { context.amount < 1000 && context.currency == "USD" };
      `);
      expect(result.policies).toHaveLength(1);
      expect(result.policies[0]!.conditions).toHaveLength(1);
    });

    it("parses a multi-policy document with mixed effects and conditions", () => {
      const result = parsePolicies(`
        // Admin access
        permit(
          principal in Group::"admins",
          action,
          resource
        );

        // Public read
        permit(
          principal,
          action == Action::"read",
          resource
        )
        when { resource.isPublic == true };

        // Block suspended users
        forbid(
          principal,
          action,
          resource
        )
        when { principal.suspended == true };

        // Block dangerous actions on sensitive resources
        forbid(
          principal,
          action in [Action::"delete", Action::"purge"],
          resource
        )
        when { resource has classification && resource.classification == "top-secret" }
        unless { principal.clearance == "top-secret" };
      `);
      expect(result.policies).toHaveLength(4);
      expect(result.policies[0]!.effect).toBe("permit");
      expect(result.policies[1]!.effect).toBe("permit");
      expect(result.policies[2]!.effect).toBe("forbid");
      expect(result.policies[3]!.effect).toBe("forbid");
      expect(result.policies[3]!.conditions).toHaveLength(2);
    });
  });

  describe("span tracking", () => {
    it("tracks span on policies", () => {
      const result = parsePolicies(`permit(principal, action, resource);`);
      const span = result.policies[0]!.span;
      expect(span.start.line).toBe(1);
      expect(span.start.column).toBe(1);
    });

    it("tracks span on conditions", () => {
      const result = parsePolicies(`
        permit(principal, action, resource)
        when { true };
      `);
      const cond = result.policies[0]!.conditions[0]!;
      expect(cond.span).toBeDefined();
      expect(cond.span.start.line).toBeGreaterThan(0);
    });
  });
});
