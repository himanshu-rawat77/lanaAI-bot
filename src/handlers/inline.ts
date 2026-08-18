import { Bot, Context } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";
import type { BotSession } from "../types";
import { LanaClient } from "../lana/client";
import { escapeHtml } from "../utils/format";

type BotContext = Context & { session: BotSession };

export function registerInlineHandlers(
  bot: Bot<BotContext>,
  deps: { lanaClient: LanaClient }
): void {
  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    if (!query) {
      await ctx.answerInlineQuery([], { cache_time: 2 });
      return;
    }

    const summary = await deps.lanaClient.analyze(
      `Answer briefly for inline Telegram usage (max 3 sentences): ${query}`,
      { model: "lana-fast" }
    );

    const result: InlineQueryResultArticle = {
      type: "article",
      id: "lana-inline-1",
      title: "Lana Solana Insight",
      description: "AI answer from Lana Solana Bot",
      input_message_content: {
        message_text: `🔮 <b>Lana Insight</b>\n\n${escapeHtml(summary)}`,
        parse_mode: "HTML"
      }
    };

    await ctx.answerInlineQuery([result], { cache_time: 5 });
  });
}
