import { Bot, Context } from "grammy";
import type { BotSession } from "../types";
import { LanaClient } from "../lana/client";
import { AddressProfileService } from "../services/address-profile";
import { formatAddressProfile } from "../utils/format";
import { looksLikeSolanaAddress } from "../utils/solana";
import { config } from "../config";
import { pushChatTurn } from "../utils/session";

type BotContext = Context & { session: BotSession };

export function registerMessageHandlers(
  bot: Bot<BotContext>,
  deps: { lanaClient: LanaClient; addressProfileService: AddressProfileService }
): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();

    if (text.startsWith("/")) {
      return;
    }

    if (looksLikeSolanaAddress(text)) {
      await ctx.reply("Detected Solana address. Running Lana lookup...");
      const profile = await deps.addressProfileService.lookup(text);
      await ctx.reply(formatAddressProfile(profile), { parse_mode: "HTML" });
      return;
    }

    if (!ctx.session.chatMode) {
      await ctx.reply("Use /chat for free-form analysis mode, or /lookup <address>.");
      return;
    }

    const answer = await deps.lanaClient.chat(text, ctx.session.chatHistory);
    pushChatTurn(ctx.session, "user", text, config.SESSION_HISTORY_LIMIT);
    pushChatTurn(ctx.session, "assistant", answer, config.SESSION_HISTORY_LIMIT);
    await ctx.reply(answer);
  });
}
