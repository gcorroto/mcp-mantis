// ---------------------------------------------------------------------------
// Relationship types
// The MantisBT REST API accepts numeric relationship type ids. These aliases let
// callers use readable names (add_relationship resolves them).
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPES = {
  DUPLICATE_OF: 0,
  RELATED_TO: 1,
  PARENT_OF: 2, // "depends on" — this issue depends on the target
  CHILD_OF: 3, // "blocks" — this issue blocks the target
  HAS_DUPLICATE: 4,
} as const;

export const RELATIONSHIP_NAME_TO_ID: Record<string, number> = {
  duplicate_of: RELATIONSHIP_TYPES.DUPLICATE_OF,
  'duplicate-of': RELATIONSHIP_TYPES.DUPLICATE_OF,
  duplicateof: RELATIONSHIP_TYPES.DUPLICATE_OF,
  related_to: RELATIONSHIP_TYPES.RELATED_TO,
  'related-to': RELATIONSHIP_TYPES.RELATED_TO,
  relatedto: RELATIONSHIP_TYPES.RELATED_TO,
  parent_of: RELATIONSHIP_TYPES.PARENT_OF,
  'parent-of': RELATIONSHIP_TYPES.PARENT_OF,
  parentof: RELATIONSHIP_TYPES.PARENT_OF,
  depends_on: RELATIONSHIP_TYPES.PARENT_OF,
  'depends-on': RELATIONSHIP_TYPES.PARENT_OF,
  dependson: RELATIONSHIP_TYPES.PARENT_OF,
  child_of: RELATIONSHIP_TYPES.CHILD_OF,
  'child-of': RELATIONSHIP_TYPES.CHILD_OF,
  childof: RELATIONSHIP_TYPES.CHILD_OF,
  blocks: RELATIONSHIP_TYPES.CHILD_OF,
  has_duplicate: RELATIONSHIP_TYPES.HAS_DUPLICATE,
  'has-duplicate': RELATIONSHIP_TYPES.HAS_DUPLICATE,
  hasduplicate: RELATIONSHIP_TYPES.HAS_DUPLICATE,
};

// ---------------------------------------------------------------------------
// Enum groups exposed by MantisBT config as `<group>_enum_string`.
// The REST API returns each already parsed as [{ id, name, label }].
// ---------------------------------------------------------------------------

export const ENUM_GROUPS = [
  'status',
  'priority',
  'severity',
  'resolution',
  'reproducibility',
] as const;

export type EnumGroup = (typeof ENUM_GROUPS)[number];

export const ENUM_CONFIG_OPTIONS = ENUM_GROUPS.map((g) => `${g}_enum_string`);

// ---------------------------------------------------------------------------
// Canonical English enum names for a standard MantisBT install. Used only as a
// FALLBACK alias when the live enum lookup (by localized name or label) misses —
// this instance is customized (Spanish names, extra statuses), so live enums win.
// Default resolved-status threshold (bug_resolved_status_threshold) is read live.
// ---------------------------------------------------------------------------

export const DEFAULT_RESOLVED_STATUS_THRESHOLD = 90;

export const CANONICAL_ENUM_NAMES: Record<EnumGroup, Record<number, string>> = {
  severity: {
    10: 'feature',
    20: 'trivial',
    30: 'text',
    40: 'tweak',
    50: 'minor',
    60: 'major',
    70: 'crash',
    80: 'block',
  },
  status: {
    10: 'new',
    20: 'feedback',
    30: 'acknowledged',
    40: 'confirmed',
    50: 'assigned',
    80: 'resolved',
    90: 'closed',
  },
  priority: { 10: 'none', 20: 'low', 30: 'normal', 40: 'high', 50: 'urgent', 60: 'immediate' },
  resolution: {
    10: 'open',
    20: 'fixed',
    30: 'reopened',
    40: 'unable to duplicate',
    50: 'not fixable',
    60: 'duplicate',
    70: 'no change required',
    80: 'suspended',
    90: 'wont fix',
  },
  reproducibility: {
    10: 'always',
    30: 'sometimes',
    50: 'random',
    70: 'have not tried',
    90: 'unable to reproduce',
    100: 'N/A',
  },
};
