import { isAllowedBoardIllustrationSrc } from "./topic-illustrations";

const ALLOWED_DIV_CLASSES = new Set(["board-story", "board-story-text"]);

const ALLOWED_TAGS = new Set([
  "div",
  "p",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "br",
  "hr",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "figure",
  "figcaption",
  "img",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

/**
 * Allowlist-sanitize digest HTML for safe home-board rendering.
 * Keeps Telegraph-compatible tags; strips scripts/events; allows http(s)/mailto hrefs on <a>.
 * Illustration <img> tags must point at portal-hosted /api/illustrations/ URLs only.
 */
export function sanitizeDigestHtml(html: string, topicId?: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }

  const tagPattern = /<\/?([a-zA-Z0-9]+)(\s[^>]*)?\s*\/?>/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  let skippingUntil: string | null = null;

  while ((match = tagPattern.exec(trimmed)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    const isClose = full.startsWith("</");

    if (skippingUntil) {
      if (isClose && tag === skippingUntil) {
        skippingUntil = null;
        last = tagPattern.lastIndex;
      } else {
        last = tagPattern.lastIndex;
      }
      continue;
    }

    out += escapeText(trimmed.slice(last, match.index));

    if (!ALLOWED_TAGS.has(tag)) {
      if (!isClose && !VOID_TAGS.has(tag) && !full.endsWith("/>")) {
        skippingUntil = tag;
      }
      last = tagPattern.lastIndex;
      continue;
    }

    if (isClose) {
      out += `</${tag}>`;
    } else if (tag === "a") {
      const href = extractHref(match[2] ?? "");
      if (href) {
        out += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`;
      } else {
        out += "<a>";
      }
    } else if (tag === "img") {
      const src = extractSrc(match[2] ?? "");
      if (src && isAllowedBoardIllustrationSrc(src, topicId)) {
        out += `<img src="${escapeAttr(src)}"/>`;
      }
    } else if (tag === "div") {
      const cls = extractClass(match[2] ?? "");
      if (cls && ALLOWED_DIV_CLASSES.has(cls)) {
        out += `<div class="${escapeAttr(cls)}">`;
      } else if (!isClose) {
        skippingUntil = "div";
      }
    } else if (VOID_TAGS.has(tag) || full.endsWith("/>")) {
      out += `<${tag}/>`;
    } else {
      out += `<${tag}>`;
    }

    last = tagPattern.lastIndex;
  }

  if (!skippingUntil) {
    out += escapeText(trimmed.slice(last));
  }
  return out;
}

/**
 * Named entities agents / sanitizers commonly emit in headings.
 * Numeric entities (&#…; / &#x…;) are handled separately.
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  trade: "\u2122",
  copy: "\u00A9",
  reg: "\u00AE",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  sbquo: "\u201A",
  bdquo: "\u201E",
  bull: "\u2022",
  middot: "\u00B7",
  deg: "\u00B0",
  times: "\u00D7",
  divide: "\u00F7",
  plusmn: "\u00B1",
  frac12: "\u00BD",
  frac14: "\u00BC",
  frac34: "\u00BE",
  eacute: "\u00E9",
  egrave: "\u00E8",
  ecirc: "\u00EA",
  aacute: "\u00E1",
  agrave: "\u00E0",
  acirc: "\u00E2",
  iacute: "\u00ED",
  oacute: "\u00F3",
  uacute: "\u00FA",
  ntilde: "\u00F1",
  ccedil: "\u00E7",
  auml: "\u00E4",
  ouml: "\u00F6",
  uuml: "\u00FC",
  szlig: "\u00DF",
};

/** Decode HTML entities; repeats to unwind double-escaped forms like `&amp;amp;`. */
function decodeHtmlEntities(value: string): string {
  let current = value;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(
      /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
      (entity, body: string) => {
        if (body.startsWith("#")) {
          const code =
            body[1]?.toLowerCase() === "x"
              ? Number.parseInt(body.slice(2), 16)
              : Number.parseInt(body.slice(1), 10);
          if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
            return entity;
          }
          try {
            return String.fromCodePoint(code);
          } catch {
            return entity;
          }
        }
        return NAMED_HTML_ENTITIES[body.toLowerCase()] ?? entity;
      },
    );
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeHeadingText(value: string): string {
  return decodeHtmlEntities(stripHtmlTags(value))
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const LEADING_HEADING_NOISE = /^(?:\s|<!--[\s\S]*?-->)*/;
const LEADING_H3 =
  /^<h3\b[^>]*>([\s\S]*?)<\/h3>\s*/i;

/**
 * Drop a leading <h3> that repeats the board card topic title
 * (agents are instructed to start HTML with that heading for Telegra.ph).
 *
 * Tolerates attributes, inner tags, HTML entities (including double-escaped
 * `&amp;`), and Unicode NFC differences.
 */
export function stripLeadingTopicHeading(html: string, topicName: string): string {
  const name = normalizeHeadingText(topicName);
  if (!html.trim() || !name) {
    return html;
  }

  const noise = LEADING_HEADING_NOISE.exec(html);
  const start = noise?.[0].length ?? 0;
  const rest = html.slice(start);
  const match = LEADING_H3.exec(rest);
  if (!match) {
    return html;
  }

  if (normalizeHeadingText(match[1] ?? "") !== name) {
    return html;
  }

  return html.slice(start + match[0].length).trim();
}

function extractHref(attrString: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrString);
  if (!match) {
    return null;
  }
  const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("mailto:")
  ) {
    return raw;
  }
  if (lower.startsWith("//")) {
    return `https:${raw}`;
  }
  return null;
}

function extractSrc(attrString: string): string | null {
  const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrString);
  if (!match) {
    return null;
  }
  return (match[1] ?? match[2] ?? match[3] ?? "").trim() || null;
}

function extractClass(attrString: string): string | null {
  const match = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrString);
  if (!match) {
    return null;
  }
  const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const first = raw.split(/\s+/)[0]?.trim();
  return first || null;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
