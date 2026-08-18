import type { Context } from "grammy";
import type { BotSession } from "../types";
import { config } from "../config";
import { LanaClient } from "../lana/client";
import { pushChatTurn } from "../utils/session";
import { splitTelegramMessage } from "../utils/format";

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
  const answer = await lanaClient.chat(trimmed, ctx.session.chatHistory);
  pushChatTurn(ctx.session, "user", trimmed, config.SESSION_HISTORY_LIMIT);
  pushChatTurn(ctx.session, "assistant", answer, config.SESSION_HISTORY_LIMIT);

  for (const chunk of splitTelegramMessage(answer)) {
    await ctx.reply(chunk);
  }
}
