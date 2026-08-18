import { Bot, Context, session } from "grammy";
import type { BotSession } from "./types";
import { config } from "./config";
import { initialSession } from "./utils/session";
import { InMemoryRateLimiter, createRateLimitMiddleware } from "./utils/rate-limit";
import { LanaClient } from "./lana/client";
import { AddressProfileService } from "./services/address-profile";
import { registerCommandHandlers } from "./handlers/commands";
import { registerMessageHandlers } from "./handlers/messages";
import { registerInlineHandlers } from "./handlers/inline";
import { formatLanaError } from "./utils/lana-errors";

export type LanaBotContext = Context & { session: BotSession };

export function createBot(): Bot<LanaBotContext> {
  const bot = new Bot<LanaBotContext>(config.TELEGRAM_BOT_TOKEN);
  const lanaClient = new LanaClient();
  const addressProfileService = new AddressProfileService(lanaClient);

  bot.use(
    session({
      initial: initialSession,
      getSessionKey: (ctx) => {
        if (ctx.chat?.id == null || ctx.from?.id == null) {
          return undefined;
        }
        return `${ctx.chat.id}:${ctx.from.id}`;
      }
    })
  );
  const limiter = new InMemoryRateLimiter(
    config.RATE_LIMIT_MAX_REQUESTS,
    config.RATE_LIMIT_WINDOW_MS
  );
  bot.use(createRateLimitMiddleware(limiter));

  registerCommandHandlers(bot, { lanaClient, addressProfileService });
  registerMessageHandlers(bot, { lanaClient, addressProfileService });
  registerInlineHandlers(bot, { lanaClient });

  bot.catch(async (errorCtx) => {
    console.error("Bot error", errorCtx.error);
    try {
      await errorCtx.ctx.reply(formatLanaError(errorCtx.error));
    } catch (err) {
      console.error("Failed to send error message", err);
    }
  });

  return bot;
}
