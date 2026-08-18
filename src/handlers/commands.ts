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
      "No wallet required. Optional: <code>/connect &lt;address&gt;</code> so I can answer “my portfolio”.",
      "",
      "<b>Try</b>",
      "• What is the current price of SOL?",
      "• Who are the largest USDC holders?",
      "• <code>/connect &lt;wallet&gt;</code> then “How did I do this week?”",
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
        "You do not need to share a wallet. Optional: /connect &lt;address&gt;.",
        "Send /stopchat to exit."
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  bot.command("stopchat", async (ctx) => {
    ctx.session.chatMode = false;
    await ctx.reply("Chat mode disabled.");
  });

  bot.command("connect", async (ctx) => {
    const address = ctx.match?.toString().trim();
    if (!address || !looksLikeSolanaAddress(address)) {
      await ctx.reply(
        "Usage: /connect <solana_wallet_address>\nSaved only in this chat so Lana can answer “my balance” / “this week”."
      );
      return;
    }
    ctx.session.connectedWallet = address;
    ctx.session.chatMode = true;
    await ctx.reply(
      `Connected <code>${escapeHtml(address)}</code>.\nAsk things like “What’s my SOL balance?” or “How did I do this week?”\n/disconnect to remove it.`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("disconnect", async (ctx) => {
    ctx.session.connectedWallet = undefined;
    await ctx.reply("Wallet disconnected. Chat still works without one.");
  });

  bot.command("portfolio", async (ctx) => {
    ctx.session.chatMode = true;
    if (ctx.session.connectedWallet) {
      await handleLanaChat(ctx, deps.lanaClient, "Summarize my portfolio and recent activity.");
      return;
    }
    await ctx.reply(
      "Connect a wallet first: /connect <solana_address>\nThen I can answer “my portfolio” using Lana user_context."
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Commands: /start, /chat, /connect, /disconnect, /lookup, /tx, /flow, /portfolio, /clear, /stopchat"
    );
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith("fu:")) {
      const index = Number(data.slice(3));
      const question = (ctx.session.pendingFollowUps ?? [])[index];
      await ctx.answerCallbackQuery();
      if (!question) {
        await ctx.reply("That follow-up expired. Ask a new question.");
        return;
      }
      ctx.session.chatMode = true;
      await handleLanaChat(ctx, deps.lanaClient, question);
      return;
    }

    if (!data.startsWith("flow:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const [, address, depthRaw] = data.split(":");
    const depth = Math.max(1, Math.min(4, Number(depthRaw ?? "2") || 2));
    await ctx.answerCallbackQuery();
    if (!address || !looksLikeSolanaAddress(address)) {
      return;
    }
    const response = await deps.lanaClient.analyze(fundFlowPrompt(address, depth));
    await ctx.reply(`<b>🌊 Fund Flow Summary</b>\n\n${escapeHtml(response)}`, { parse_mode: "HTML" });
  });

  bot.command("clear", async (ctx) => {
    ctx.session.chatHistory = [];
    await ctx.reply("Cleared conversation context. Ask another question anytime.");
  });
}
