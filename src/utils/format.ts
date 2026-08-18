import type { AddressProfile } from "../types";
import type { LanaSource, LanaTurnResult } from "../lana/types";
import { InlineKeyboard } from "grammy";

export function splitTelegramMessage(text: string, maxLen = 3900): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen / 2) {
      cut = maxLen;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatAddressProfile(profile: AddressProfile): string {
  const labels =
    profile.labels.length > 0 ? profile.labels.map((x) => `• ${escapeHtml(x)}`).join("\n") : "• Unlabeled";
  const counterparties =
    profile.topCounterparties.length > 0
      ? profile.topCounterparties.map((x, i) => `${i + 1}. <code>${escapeHtml(x)}</code>`).join("\n")
      : "No visible counterparties.";

  return [
    `<b>🔎 Lana Address Lookup</b>`,
    ``,
    `<b>Address</b>`,
    `<code>${escapeHtml(profile.address)}</code>`,
    ``,
    `<b>Risk Score</b>: ${profile.riskScore}/100 (${escapeHtml(profile.reputation)})`,
    `<b>First Activity</b>: ${escapeHtml(profile.firstActivityDate)}`,
    ``,
    `<b>Known Labels</b>`,
    labels,
    ``,
    `<b>Top Counterparties</b>`,
    counterparties,
    ``,
    `<b>AI Narrative</b>`,
    escapeHtml(profile.narrative)
  ].join("\n");
}

export function formatTxExplanation(summary: string, tokenMovements: string[], riskNotes: string[]): string {
  const moves = tokenMovements.length > 0 ? tokenMovements.map((x) => `• ${escapeHtml(x)}`).join("\n") : "• None";
  const risks = riskNotes.length > 0 ? riskNotes.map((x) => `• ${escapeHtml(x)}`).join("\n") : "• No major risk flags.";

  return [
    "<b>🧾 Transaction Insight</b>",
    "",
    `<b>Summary</b>`,
    escapeHtml(summary),
    "",
    `<b>Token Movements</b>`,
    moves,
    "",
    `<b>Risk Notes</b>`,
    risks
  ].join("\n");
}

export function formatChatHtml(result: LanaTurnResult): string {
  const body = applyCitations(escapeHtml(result.text), result.sources);
  const sources = formatSources(result.sources);
  return [body, sources].filter(Boolean).join("\n\n");
}

export function applyCitations(escapedText: string, sources: LanaSource[]): string {
  return escapedText.replace(/\{\{cite:(\d+)\}\}/g, (_match, indexRaw: string) => {
    const index = Number(indexRaw);
    const source = sources.find((item) => item.index === index);
    const label = `[${index + 1}]`;
    if (!source?.url) {
      return label;
    }
    return `<a href="${escapeHtml(source.url)}">${label}</a>`;
  });
}

export function formatSources(sources: LanaSource[]): string {
  if (sources.length === 0) {
    return "";
  }
  const lines = sources
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((source) => {
      const title = escapeHtml(source.title || source.url);
      return `${source.index + 1}. <a href="${escapeHtml(source.url)}">${title}</a>`;
    });
  return `<b>Sources</b>\n${lines.join("\n")}`;
}

export function followUpKeyboard(suggestions: string[]): InlineKeyboard | undefined {
  const items = suggestions.filter(Boolean).slice(0, 4);
  if (items.length === 0) {
    return undefined;
  }
  const keyboard = new InlineKeyboard();
  for (const [index, suggestion] of items.entries()) {
    const label = suggestion.length > 42 ? `${suggestion.slice(0, 39)}…` : suggestion;
    keyboard.text(label, `fu:${index}`).row();
  }
  return keyboard;
}

export function safeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return base || "lana-export.txt";
}
