function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, "\u00a0");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractCellTexts(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellPattern = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellPattern.exec(rowHtml)) !== null) {
    cells.push(stripHtmlToText(match[2] ?? ""));
  }
  return cells;
}

export function parseTableHtml(tableInnerHtml: string): {
  headers: string[];
  rows: string[][];
} {
  const rowHtmls: string[] = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(tableInnerHtml)) !== null) {
    rowHtmls.push(match[1] ?? "");
  }

  const parsedRows = rowHtmls
    .map(extractCellTexts)
    .filter((row) => row.some((cell) => cell.length > 0));

  if (parsedRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const firstRowHasHeaderCells = /<th\b/i.test(rowHtmls[0] ?? "");
  if (firstRowHasHeaderCells) {
    return {
      headers: parsedRows[0] ?? [],
      rows: parsedRows.slice(1),
    };
  }

  return { headers: [], rows: parsedRows };
}

export function formatTableAsTelegraphHtml(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return "";
  }

  const items: string[] = [];

  for (const row of rows) {
    if (row.every((cell) => !cell)) {
      continue;
    }

    if (headers.length > 0 && headers.length === row.length) {
      const [label, ...values] = row;
      if (!label) {
        continue;
      }
      if (values.length === 0) {
        items.push(`<li>${escapeHtml(label)}</li>`);
        continue;
      }

      const parts = values
        .map((value, index) => {
          const header = headers[index + 1]?.trim();
          if (!value) {
            return "";
          }
          return header
            ? `<strong>${escapeHtml(header)}:</strong> ${escapeHtml(value)}`
            : escapeHtml(value);
        })
        .filter(Boolean);

      items.push(
        `<li><strong>${escapeHtml(label)}</strong>${parts.length ? ` — ${parts.join(" · ")}` : ""}</li>`,
      );
      continue;
    }

    items.push(`<li>${row.filter(Boolean).map(escapeHtml).join(" · ")}</li>`);
  }

  return items.length > 0 ? `<ul>${items.join("")}</ul>` : "";
}

const TABLE_PATTERN = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;

/** Replace HTML tables with Telegra.ph-friendly bullet lists. */
export function convertTablesForTelegraph(html: string): string {
  if (!html.trim() || !/<table\b/i.test(html)) {
    return html;
  }

  return html.replace(TABLE_PATTERN, (_full, inner: string) => {
    const { headers, rows } = parseTableHtml(inner);
    const replacement = formatTableAsTelegraphHtml(headers, rows);
    return replacement || "";
  });
}
