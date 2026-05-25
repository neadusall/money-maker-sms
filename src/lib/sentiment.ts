import type { ClassificationLabel } from "@/db/schema";

/**
 * Buckets the AI reply classifications into a simple positive / neutral /
 * negative sentiment so campaign stats can show interest at a glance.
 */
export const POSITIVE_LABELS: ClassificationLabel[] = [
  "positive",
  "curious",
  "asked_email",
  "asked_compensation",
  "asked_remote",
  "asked_client",
  "referral",
];

export const NEGATIVE_LABELS: ClassificationLabel[] = [
  "negative",
  "not_interested",
  "wrong_person",
  "already_employed",
  "stop",
];

export type Sentiment = "positive" | "neutral" | "negative";

export function sentimentOf(label: string | null | undefined): Sentiment {
  if (!label) return "neutral";
  if ((POSITIVE_LABELS as string[]).includes(label)) return "positive";
  if ((NEGATIVE_LABELS as string[]).includes(label)) return "negative";
  return "neutral"; // later, other, unclassified
}

/** Pretty, human-readable label for a classification value. */
export function classificationLabel(label: string | null | undefined): string {
  if (!label) return "Unclassified";
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
