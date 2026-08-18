import { Bot, Context, InlineKeyboard } from "grammy";
import { config } from "../config";
import type { BotSession } from "../types";
import { AddressProfileService } from "../services/address-profile";
import { formatAddressProfile, formatTxExplanation, escapeHtml } from "../utils/format";
import { looksLikeSolanaAddress } from "../utils/solana";
import { pushChatTurn } from "../utils/session";
import { LanaClient } from "../lana/client";
import { fundFlowPrompt } from "../lana/prompts";

type BotContext = Context & { session: BotSession };

export function registerCommandHandlers(
  bot: Bot<BotContext>,
  deps: { addressProfileService: AddressProfileService; lanaClient: LanaClient }
): void {
  bot.command("start", async (ctx) => {
    const text = [
      "<b>👋 Welcome to Lana Solana Bot</b>",
      "",
      "I can analyze Solana wallets, transactions, and money flow in plain English.",
      "",
      "<b>Examples</b>",
      "• <code>/lookup &lt;wallet_address&gt;</code>",
      "• <code>/tx &lt;transaction_signature&gt;</code>",
      "• <code>/flow &lt;wallet_address&gt; 2</code>",
      "• <code>/chat</code> to start AI analyst mode",
      "",
      "Paste an address directly and I will auto-analyze it."
    ].join("\n");

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  bot.command("lookup", async (ctx) => {
    const input = ctx.match?.toString().trim();
    if (!input || !looksLikeSolanaAddress(input)) {
      await ctx.reply("Usage: /lookup <valid_solana_address>");
      return;
    }

    await ctx.reply("Analyzing address with Lana AI...");
    const profile = await deps.addressProfileService.lookup(input);
    await ctx.reply(formatAddressProfile(profile), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Explain fund flow", `flow:${input}:2`)
    });
  });

  bot.command("tx", async (ctx) => {
    const signature = ctx.match?.toString().trim();
    if (!signature) {
      await ctx.reply("Usage: /tx <transaction_signature>");
      return;
    }

    await ctx.reply("Decoding transaction...");
    const tx = await deps.lanaClient.explainTransaction(signature);
    await ctx.reply(formatTxExplanation(tx.summary, tx.tokenMovements, tx.riskNotes), {
      parse_mode: "HTML"
    });
  });

  bot.command("flow", async (ctx) => {
    const [address, depthRaw] = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (!address || !looksLikeSolanaAddress(address)) {
      await ctx.reply("Usage: /flow <address> [depth]");
      return;
    }
    const depth = Math.max(1, Math.min(4, Number(depthRaw ?? "2") || 2));

    const response = await deps.lanaClient.analyze(fundFlowPrompt(address, depth));
    await ctx.reply(`<b>🌊 Fund Flow Summary</b>\n\n${escapeHtml(response)}`, { parse_mode: "HTML" });
  });

  bot.command("chat", async (ctx) => {
    ctx.session.chatMode = true;
    await ctx.reply(
      "Chat mode enabled. Ask any Solana intelligence question.\nSend /stopchat to exit."
    );
  });

  bot.command("stopchat", async (ctx) => {
    ctx.session.chatMode = false;
    await ctx.reply("Chat mode disabled.");
  });

  bot.command("portfolio", async (ctx) => {
    await ctx.reply(
      "Send your wallet address and I will generate a portfolio-style overview. Wallet connect support can be added next."
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Commands: /start, /lookup, /tx, /flow, /chat, /stopchat, /portfolio"
    );
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("flow:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const [, address, depthRaw] = data.split(":");
    const depth = Math.max(1, Math.min(4, Number(depthRaw ?? "2") || 2));
    const response = await deps.lanaClient.analyze(fundFlowPrompt(address, depth));
    await ctx.reply(`<b>🌊 Fund Flow Summary</b>\n\n${escapeHtml(response)}`, { parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
  });

  bot.command("clear", async (ctx) => {
    ctx.session.chatHistory = [];
    pushChatTurn(ctx.session, "system", "Conversation reset", config.SESSION_HISTORY_LIMIT);
    await ctx.reply("Cleared conversation context.");
  });
}
