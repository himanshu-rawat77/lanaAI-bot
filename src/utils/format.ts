import type { AddressProfile } from "../types";

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
