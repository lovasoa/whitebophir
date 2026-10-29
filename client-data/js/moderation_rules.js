/**
 * The shared moderation rules, action durations, and presentation metadata.
 * Keep this list deliberately small: rule copy stays in translations and
 * icons stay as ordinary static SVG assets.
 */
export const MODERATION_RULES = Object.freeze([
  {
    id: "drawings",
    iconFile: "respect-other-peoples-drawings.svg",
    titleKey: "rules_drawings_title",
    bodyKeys: ["rules_drawings_body"],
  },
  {
    id: "spam",
    iconFile: "no-spam.svg",
    titleKey: "rules_spam_title",
    bodyKeys: ["rules_spam_body"],
  },
  {
    id: "harassment",
    iconFile: "no-harassment-personal-attacks.svg",
    titleKey: "rules_harassment_title",
    bodyKeys: ["rules_harassment_body"],
  },
  {
    id: "violence",
    iconFile: "no-violence-or-hate-speech.svg",
    titleKey: "rules_violence_title",
    bodyKeys: ["rules_violence_body", "rules_violence_threats"],
  },
  {
    id: "pornography",
    iconFile: "no-pornography.svg",
    titleKey: "rules_pornography_title",
    bodyKeys: ["rules_pornography_nudity", "rules_pornography_body"],
  },
  {
    id: "gore",
    iconFile: "no-graphic-gore.svg",
    titleKey: "rules_gore_title",
    bodyKeys: ["rules_gore_body", "rules_gore_detail"],
  },
  {
    id: "moderation_decisions",
    iconFile: "respect-moderation-decisions.svg",
    titleKey: "rules_moderation_decisions_title",
    bodyKeys: ["rules_moderation_decisions_body"],
  },
  {
    id: "illegal",
    iconFile: "no-illegal-content.svg",
    titleKey: "rules_illegal_title",
    bodyKeys: ["rules_illegal_law", "rules_illegal_responsibility"],
  },
]);

export const MODERATION_RULE_IDS = new Set(
  MODERATION_RULES.map((rule) => rule.id),
);

/** @param {string | undefined} id */
export function getModerationRule(id) {
  return MODERATION_RULES.find((rule) => rule.id === id);
}

/** @type {({durationMs: 0, labelKey: "warn", variant: "secondary"} | {durationMs: number, count: number, unit: "minute" | "hour" | "day", variant: "secondary" | "warning" | "danger"})[]} */
export const MODERATION_DURATION_OPTIONS = [
  {
    durationMs: 0,
    labelKey: "warn",
    variant: "secondary",
  },
  {
    durationMs: 15 * 60 * 1000,
    count: 15,
    unit: "minute",
    variant: "secondary",
  },
  {
    durationMs: 30 * 60 * 1000,
    count: 30,
    unit: "minute",
    variant: "secondary",
  },
  {
    durationMs: 24 * 60 * 60 * 1000,
    count: 24,
    unit: "hour",
    variant: "warning",
  },
  {
    durationMs: 7 * 24 * 60 * 60 * 1000,
    count: 7,
    unit: "day",
    variant: "danger",
  },
];

// Socket admission and the dialog use the same duration choices.
export const MODERATION_DURATIONS = new Set(
  MODERATION_DURATION_OPTIONS.map((option) => option.durationMs),
);
