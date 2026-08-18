import { GrammyError, InputFile } from "grammy";
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
        await safeEditMessageText(ctx, chatId, messageId, snippet);
      }
    });
  } catch (error) {
    const message = formatLanaError(error);
    const edited = await safeEditMessageText(ctx, chatId, messageId, message);
    if (!edited) {
      await ctx.reply(message);
    }
    return;
  }

  pushChatTurn(ctx.session, "user", trimmed, config.SESSION_HISTORY_LIMIT);
  pushChatTurn(ctx.session, "assistant", result.text || "(structured response)", config.SESSION_HISTORY_LIMIT);
  ctx.session.pendingFollowUps = result.followUps;

  await finalizeAnswer(ctx, chatId, messageId, result, lastShown);
  await sendUiCards(ctx, result);
  await sendDocuments(ctx, result.documents);
}

async function finalizeAnswer(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  result: LanaTurnResult,
  lastShown: string
): Promise<void> {
  const keyboard = followUpKeyboard(result.followUps);
  const html = formatChatHtml(result) || "<i>Lana returned a structured result.</i>";
  const chunks = splitTelegramMessage(html);
  const firstChunk = chunks[0] ?? html;
  const markup = chunks.length === 1 ? keyboard : undefined;
  const alreadyShown = firstChunk === lastShown && !markup;

  if (!alreadyShown) {
    const edited = await safeEditMessageText(ctx, chatId, messageId, firstChunk, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: markup
    });

    if (!edited) {
      const plain = (result.text || "Done.").slice(0, 3900);
      if (plain !== lastShown || markup) {
        await safeEditMessageText(ctx, chatId, messageId, plain, {
          reply_markup: markup
        });
      }
    }
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

function isMessageNotModified(error: unknown): boolean {
  if (!(error instanceof GrammyError)) {
    return String(error).includes("message is not modified");
  }
  return error.description.toLowerCase().includes("message is not modified");
}

async function safeEditMessageText(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  text: string,
  extra?: Parameters<BotContext["api"]["editMessageText"]>[3]
): Promise<boolean> {
  if (!text.trim()) {
    return false;
  }
  try {
    await ctx.api.editMessageText(chatId, messageId, text, extra);
    return true;
  } catch (error) {
    if (isMessageNotModified(error)) {
      return true;
    }
    return false;
  }
}
