import { escapeHtml } from "../utils/format";

const MAX_CARDS = 4;
const MAX_ROWS = 8;
const MAX_CELL = 48;

export function renderUiSchemaCards(schema: unknown): string[] {
  if (schema == null) {
    return [];
  }

  const nodes = flattenNodes(schema);
  const cards = nodes
    .map((node) => renderNode(node))
    .filter((card): card is string => Boolean(card));

  return cards.slice(0, MAX_CARDS);
}

function flattenNodes(schema: unknown): unknown[] {
  if (Array.isArray(schema)) {
    return schema;
  }
  if (!isRecord(schema)) {
    return [];
  }

  const nested =
    schema.components ??
    schema.children ??
    schema.blocks ??
    schema.items ??
    schema.elements;
  if (Array.isArray(nested) && nested.length > 0) {
    return nested;
  }
  return [schema];
}

function renderNode(node: unknown): string | null {
  if (!isRecord(node)) {
    return null;
  }

  const title = firstString(node, [
    "title",
    "heading",
    "label",
    "name",
    "component",
    "type"
  ]);
  const description = firstString(node, ["description", "subtitle", "caption", "text"]);
  const table = renderTable(node);
  const metrics = renderMetrics(node);
  const list = renderList(node);

  if (!title && !description && !table && !metrics && !list) {
    return null;
  }

  return [
    title ? `<b>${escapeHtml(humanize(title))}</b>` : "<b>Lana card</b>",
    description ? escapeHtml(truncate(description, 400)) : "",
    metrics,
    table,
    list
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTable(node: Record<string, unknown>): string {
  const rowsRaw = node.rows ?? node.data ?? node.holders ?? node.tokens ?? node.accounts;
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return "";
  }

  const columns = Array.isArray(node.columns)
    ? node.columns.map((col) => String(isRecord(col) ? col.key ?? col.label ?? col : col))
    : inferColumns(rowsRaw);

  const header = columns.map((col) => truncate(humanize(col), 16)).join(" | ");
  const lines = rowsRaw.slice(0, MAX_ROWS).map((row) => {
    if (isRecord(row)) {
      return columns
        .map((col) => truncate(stringifyCell(row[col] ?? row.label ?? row.address ?? row.value), MAX_CELL))
        .join(" | ");
    }
    return truncate(String(row), MAX_CELL);
  });

  const extra =
    rowsRaw.length > MAX_ROWS ? `\n… ${rowsRaw.length - MAX_ROWS} more` : "";

  return `<pre>${escapeHtml([header, ...lines].join("\n"))}${escapeHtml(extra)}</pre>`;
}

function renderMetrics(node: Record<string, unknown>): string {
  const metricKeys = ["value", "price", "balance", "amount", "count", "risk", "score", "marketCap"];
  const parts: string[] = [];
  for (const key of metricKeys) {
    if (node[key] == null || typeof node[key] === "object") {
      continue;
    }
    parts.push(`<b>${escapeHtml(humanize(key))}</b>: ${escapeHtml(String(node[key]))}`);
  }
  return parts.join("\n");
}

function renderList(node: Record<string, unknown>): string {
  const items = node.items ?? node.entries ?? node.points;
  if (!Array.isArray(items) || items.length === 0 || isRecord(items[0])) {
    return "";
  }
  return items
    .slice(0, MAX_ROWS)
    .map((item) => `• ${escapeHtml(truncate(String(item), 120))}`)
    .join("\n");
}

function inferColumns(rows: unknown[]): string[] {
  const first = rows.find((row) => isRecord(row));
  if (!isRecord(first)) {
    return ["value"];
  }
  return Object.keys(first).slice(0, 4);
}

function stringifyCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.label ?? record.name ?? record.address ?? record.value ?? "");
  }
  return String(value);
}

function firstString(node: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof node[key] === "string" && node[key].trim()) {
      return node[key] as string;
    }
  }
  return undefined;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
