export type IngestQuality = "kept" | "ads" | "fluff" | "question" | "other";

const MOSTLY_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]+$/u;

const ADS_PATTERNS = [
  /#?реклам/i,
  /\bads?\b/i,
  /sponsored/i,
  /подпишис/i,
  /subscribe\s+(now|here|pls|please)/i,
  /только\s+сегодня/i,
  /скидк[аи]/i,
  /promo\s*code/i,
  /промокод/i,
  /заказать\s+сейчас/i,
  /t\.me\/\+/i,
];

const JOIN_LEAVE =
  /^(?:.+ (?:joined|left|invited|removed|pinned|unpinned|changed|created) .+|(?:joined|left) the (?:group|channel))$/i;

/**
 * Layer-1 rule filter for chat noise (DD-0005).
 * Does not call an LLM.
 */
export function classifyIngestText(
  text: string,
  options: { isService?: boolean; hasMediaOnly?: boolean } = {},
): IngestQuality {
  const trimmed = (text ?? "").trim();

  if (options.isService) {
    return "other";
  }
  if (!trimmed) {
    return options.hasMediaOnly ? "fluff" : "other";
  }
  if (JOIN_LEAVE.test(trimmed)) {
    return "other";
  }
  if (MOSTLY_EMOJI.test(trimmed) && trimmed.length < 40) {
    return "fluff";
  }
  for (const pattern of ADS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "ads";
    }
  }
  // Short pure question with no URL → question seed, not digest fodder
  if (
    trimmed.length <= 120 &&
    /\?\s*$/.test(trimmed) &&
    !/https?:\/\//i.test(trimmed) &&
    trimmed.split(/\s+/).length <= 18
  ) {
    return "question";
  }
  if (trimmed.length < 12 && !/https?:\/\//i.test(trimmed)) {
    return "fluff";
  }
  return "kept";
}
