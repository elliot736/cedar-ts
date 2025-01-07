// ── Cedar Schema Types ───────────────────────────────────────────────

/**
 * A Cedar schema describes entity types, their attributes, and
 * which actions apply to which principal/resource types.
 */
export interface CedarSchema {
  /** Namespace for all types in this schema. Empty string for default namespace. */
  namespace?: string;
  entityTypes: Record<string, EntityTypeSchema>;
  actions: Record<string, ActionSchema>;
}

export interface EntityTypeSchema {
  /** Attribute definitions for this entity type. */
  shape?: RecordTypeSchema;
  /** Entity types that this type can be a member of (parents). */
  memberOfTypes?: string[];
}

export interface ActionSchema {
  /** Principal types this action applies to. */
  appliesTo?: {
    principalTypes?: string[];
    resourceTypes?: string[];
    context?: RecordTypeSchema;
  };
  /** Actions this action is a member of (parent actions). */
  memberOf?: { id: string; type?: string }[];
}

// ── Type schemas ─────────────────────────────────────────────────────

export type TypeSchema =
  | PrimitiveTypeSchema
  | SetTypeSchema
  | RecordTypeSchema
  | EntityRefTypeSchema;

export interface PrimitiveTypeSchema {
  type: "String" | "Long" | "Boolean";
}

export interface SetTypeSchema {
  type: "Set";
  element: TypeSchema;
}

export interface RecordTypeSchema {
  type: "Record";
  attributes: Record<string, AttributeSchema>;
}

export interface EntityRefTypeSchema {
  type: "Entity";
  name: string;
}

export interface AttributeSchema {
  type: TypeSchema;
  required?: boolean;
}
