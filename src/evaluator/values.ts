// ── Cedar Value Types ────────────────────────────────────────────────

/**
 * An EntityUID is a typed identifier, e.g. User::"alice".
 */
export interface EntityUID {
  type: string;
  id: string;
}

export function entityUIDToString(uid: EntityUID): string {
  return `${uid.type}::"${uid.id}"`;
}

export function entityUIDEquals(a: EntityUID, b: EntityUID): boolean {
  return a.type === b.type && a.id === b.id;
}

export function entityUIDKey(uid: EntityUID): string {
  return `${uid.type}::"${uid.id}"`;
}

/**
 * A CedarValue is any value that can appear during policy evaluation.
 */
export type CedarValue =
  | boolean
  | number
  | string
  | EntityUID
  | CedarSet
  | CedarRecord
  | CedarExtension;

/**
 * An unordered set of Cedar values.
 */
export class CedarSet {
  private items: CedarValue[];

  constructor(items: CedarValue[] = []) {
    this.items = [...items];
  }

  get elements(): ReadonlyArray<CedarValue> {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  contains(value: CedarValue): boolean {
    return this.items.some((item) => cedarValueEquals(item, value));
  }

  containsAll(other: CedarSet): boolean {
    return other.items.every((item) => this.contains(item));
  }

  containsAny(other: CedarSet): boolean {
    return other.items.some((item) => this.contains(item));
  }
}

/**
 * A string-keyed record of Cedar values.
 */
export interface CedarRecord {
  [key: string]: CedarValue;
}

/**
 * Stub for extension types (ip, decimal).
 */
export interface CedarExtension {
  __extension: string;
  value: string;
}

// ── Type guards ──────────────────────────────────────────────────────

export function isEntityUID(v: CedarValue): v is EntityUID {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    "id" in v &&
    typeof (v as EntityUID).type === "string" &&
    typeof (v as EntityUID).id === "string" &&
    !("__extension" in v) &&
    !(v instanceof CedarSet)
  );
}

export function isCedarSet(v: CedarValue): v is CedarSet {
  return v instanceof CedarSet;
}

export function isCedarRecord(v: CedarValue): v is CedarRecord {
  return (
    typeof v === "object" &&
    v !== null &&
    !isEntityUID(v) &&
    !isCedarSet(v) &&
    !isCedarExtension(v)
  );
}

export function isCedarExtension(v: CedarValue): v is CedarExtension {
  return (
    typeof v === "object" &&
    v !== null &&
    "__extension" in v
  );
}

// ── Equality ─────────────────────────────────────────────────────────

export function cedarValueEquals(a: CedarValue, b: CedarValue): boolean {
  if (typeof a !== typeof b) {
    // One might be an object while the other is a primitive
    if (typeof a === "object" && typeof b === "object") {
      // fall through
    } else {
      return false;
    }
  }

  if (typeof a === "boolean" || typeof a === "number" || typeof a === "string") {
    return a === b;
  }

  if (isEntityUID(a) && isEntityUID(b as CedarValue)) {
    return entityUIDEquals(a, b as EntityUID);
  }

  if (isCedarSet(a) && isCedarSet(b as CedarValue)) {
    const bSet = b as CedarSet;
    if (a.size !== bSet.size) return false;
    return a.containsAll(bSet) && bSet.containsAll(a);
  }

  // Records: compare keys and values
  if (isCedarRecord(a) && isCedarRecord(b as CedarValue)) {
    const bRec = b as CedarRecord;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(bRec);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (k) => k in bRec && cedarValueEquals(a[k]!, bRec[k]!),
    );
  }

  return false;
}
