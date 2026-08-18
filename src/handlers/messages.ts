import { Bot, Context } from "grammy";
import type { BotSession } from "../types";
import { LanaClient } from "../lana/client";
import { AddressProfileService } from "../services/address-profile";
import { formatAddressProfile } from "../utils/format";
import { looksLikeSolanaAddress } from "../utils/solana";
import { handleLanaChat } from "./chat";

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

    const chatModeOn = ctx.session.chatMode;

    if (chatModeOn) {
      await handleLanaChat(ctx, deps.lanaClient, text);
      return;
    }

    if (looksLikeSolanaAddress(text)) {
      await ctx.reply("Detected Solana address. Running Lana lookup...");
      const profile = await deps.addressProfileService.lookup(text);
      await ctx.reply(formatAddressProfile(profile), { parse_mode: "HTML" });
      return;
    }

    await ctx.reply("Send /chat to talk to Lana, or /lookup <address> for a reputation card.");
  });
}
