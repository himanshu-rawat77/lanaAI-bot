import { InputFile } from "grammy";
import type { Context } from "grammy";
import type { BotSession } from "../types";
import { config } from "../config";
import { LanaClient } from "../lana/client";
import type { LanaDocument, LanaTurnResult } from "../lana/types";
import { renderUiSchemaCards } from "../lana/ui-renderer";
import { pushChatTurn } from "../utils/session";
import { formatLanaError } from "../utils/lana-errors";
import {
  formatChatHtml,
  followUpKeyboard,
  safeFilename,
  splitTelegramMessage
} from "../utils/format";

type BotContext = Context & { session: BotSession };

export async function handleLanaChat(
  ctx: BotContext,
  lanaClient: LanaClient,
  question: string
): Promise<void> {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  await ctx.replyWithChatAction("typing");
  const placeholder = await ctx.reply("Lana is analyzing…");
  const chatId = placeholder.chat.id;
  const messageId = placeholder.message_id;

  let lastEditAt = 0;
  let lastShown = "";

  let result: LanaTurnResult;
  try {
    result = await lanaClient.chat(trimmed, ctx.session.chatHistory, {
      wallet: ctx.session.connectedWallet,
      timeZone: ctx.session.timeZone ?? config.LANA_TIMEZONE,
      stream: config.LANA_STREAM,
      onDelta: async (text) => {
        const now = Date.now();
        if (now - lastEditAt < 450) {
          return;
        }
        lastEditAt = now;
        const snippet = (text.trim() || "Lana is analyzing…").slice(0, 3900);
        if (snippet === lastShown) {
          return;
        }
        lastShown = snippet;
        try {
          await ctx.api.editMessageText(chatId, messageId, snippet);
        } catch {
          // Telegram flood control or unchanged content — ignore mid-stream.
        }
      }
    });
  } catch (error) {
    try {
      await ctx.api.editMessageText(chatId, messageId, formatLanaError(error));
    } catch {
      await ctx.reply(formatLanaError(error));
    }
    return;
  }

  pushChatTurn(ctx.session, "user", trimmed, config.SESSION_HISTORY_LIMIT);
  pushChatTurn(ctx.session, "assistant", result.text || "(structured response)", config.SESSION_HISTORY_LIMIT);
  ctx.session.pendingFollowUps = result.followUps;

  await finalizeAnswer(ctx, chatId, messageId, result);
  await sendUiCards(ctx, result);
  await sendDocuments(ctx, result.documents);
}

async function finalizeAnswer(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  result: LanaTurnResult
): Promise<void> {
  const keyboard = followUpKeyboard(result.followUps);
  const html = formatChatHtml(result) || "<i>Lana returned a structured result.</i>";
  const chunks = splitTelegramMessage(html);

  try {
    await ctx.api.editMessageText(chatId, messageId, chunks[0] ?? html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: chunks.length === 1 ? keyboard : undefined
    });
  } catch {
    await ctx.api.editMessageText(chatId, messageId, (result.text || "Done.").slice(0, 3900), {
      reply_markup: chunks.length === 1 ? keyboard : undefined
    });
  }

  const rest = chunks.slice(1);
  for (const [index, chunk] of rest.entries()) {
    const isLast = index === rest.length - 1;
    await ctx.reply(chunk, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: isLast ? keyboard : undefined
    });
  }
}

async function sendUiCards(ctx: BotContext, result: LanaTurnResult): Promise<void> {
  const cards = renderUiSchemaCards(result.uiSchema);
  for (const card of cards) {
    await ctx.reply(card, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true }
    });
  }
}

async function sendDocuments(ctx: BotContext, documents: LanaDocument[]): Promise<void> {
  for (const doc of documents.slice(0, 8)) {
    if (!doc.content) {
      continue;
    }
    const filename = safeFilename(doc.filename);
    const caption = doc.description ? doc.description.slice(0, 900) : `Lana export · ${doc.format}`;
    await ctx.replyWithDocument(new InputFile(Buffer.from(doc.content, "utf8"), filename), {
      caption
    });
  }
}
