import { Bot, Context, InlineKeyboard } from "grammy";
import type { BotSession } from "../types";
import { AddressProfileService } from "../services/address-profile";
import { formatAddressProfile, formatTxExplanation, escapeHtml } from "../utils/format";
import { looksLikeSolanaAddress } from "../utils/solana";
import { LanaClient } from "../lana/client";
import { fundFlowPrompt } from "../lana/prompts";
import { handleLanaChat } from "./chat";

type BotContext = Context & { session: BotSession };

export function registerCommandHandlers(
  bot: Bot<BotContext>,
  deps: { addressProfileService: AddressProfileService; lanaClient: LanaClient }
): void {
  bot.command("start", async (ctx) => {
    ctx.session.chatMode = true;
    const text = [
      "<b>👋 Welcome to Lana Solana Bot</b>",
      "",
      "Ask me anything about Solana — wallets, tokens, prices, or on-chain activity.",
      "No wallet required. Just type a question, like OrbAI.",
      "",
      "<b>Try</b>",
      "• What is the current price of SOL?",
      "• Who are the largest USDC holders?",
      "• <code>/chat</code> then ask a follow-up",
      "• <code>/lookup &lt;address&gt;</code> for a reputation card",
      "• <code>/tx &lt;signature&gt;</code> to explain a transaction"
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
    const question = ctx.match?.toString().trim();

    if (question) {
      await handleLanaChat(ctx, deps.lanaClient, question);
      return;
    }

    await ctx.reply(
      [
        "<b>Lana chat is on</b> — ask anything about Solana.",
        "",
        "Examples:",
        "• What is the current price of SOL?",
        "• How many holders does USDC have?",
        "• What did this program do last week?",
        "",
        "You do not need to share a wallet. Send /stopchat to exit."
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  bot.command("stopchat", async (ctx) => {
    ctx.session.chatMode = false;
    await ctx.reply("Chat mode disabled.");
  });

  bot.command("portfolio", async (ctx) => {
    ctx.session.chatMode = true;
    await ctx.reply(
      "Ask me about any wallet in chat — for example: “What’s in JUP’s treasury?” You can also paste an address. /lookup still gives a reputation card."
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
    await ctx.reply("Cleared conversation context. Ask another question anytime.");
  });
}
