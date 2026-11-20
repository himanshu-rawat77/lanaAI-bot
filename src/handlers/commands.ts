import { Bot, Context, InlineKeyboard } from "grammy";
import type { BotSession } from "../types";
import { AddressProfileService } from "../services/address-profile";
import { formatAddressProfile, formatTxExplanation, escapeHtml } from "../utils/format";
import { looksLikeSolanaAddress } from "../utils/solana";
import { LanaClient } from "../lana/client";
import { fundFlowPrompt } from "../lana/prompts";
import { handleLanaChat } from "./chat";
import { walletService } from "../services/wallet";
import { privacyService } from "../services/privacy";

type BotContext = Context & { session: BotSession };

export function registerCommandHandlers(
  bot: Bot<BotContext>,
  deps: { addressProfileService: AddressProfileService; lanaClient: LanaClient }
): void {
  bot.command("start", async (ctx) => {
    ctx.session.chatMode = true;

    let walletAddressText = "";
    if (ctx.from?.id) {
      try {
        const { record, isNew } = await walletService.getOrCreateWallet(
          ctx.from.id,
          ctx.from.username
        );
        ctx.session.connectedWallet = record.publicKey;
        walletAddressText = `\n🛡️ <b>Your Private Wallet:</b> <code>${escapeHtml(
          record.publicKey
        )}</code> ${isNew ? "(Newly Generated)" : ""}\n`;
      } catch (err) {
        console.warn("Wallet creation on /start notice:", err);
      }
    }

    const text = [
      "<b>👋 Welcome to Lana Solana Intelligence & Privacy Bot</b>",
      walletAddressText,
      "Powered by Lana AI and Helius Solana Privacy Rings.",
      "",
      "<b>🔒 Confidential Payments (Privacy Rings):</b>",
      "• <code>/wallet</code> — View your private wallet & balances",
      "• <code>/switchwallet</code> — Switch active main wallet",
      "• <code>/importkey &lt;base58&gt;</code> — Connect & import Phantom wallet",
      "• <code>/deposit</code> — Shield SOL into the private pool",
      "• <code>/send &lt;amount&gt; &lt;address|@user&gt;</code> — Confidential transfer",
      "• <code>/balance</code> — Check encrypted shielded balance",
      "• <code>/withdraw &lt;amount&gt; &lt;address&gt;</code> — Withdraw to public address",
      "• <code>/exportkey</code> — Backup your private key seed",
      "",
      "<b>🧠 Lana On-Chain AI Intelligence:</b>",
      "• <code>/lookup &lt;address&gt;</code> — Reputation card & profile",
      "• <code>/tx &lt;signature&gt;</code> — Decode & explain transaction",
      "• <code>/flow &lt;address&gt;</code> — Fund flow summary",
      "• <code>/chat</code> — Free-form conversational Solana analysis",
      "• <code>/portfolio</code> — Summarize your wallet's activity",
      "",
      "Try asking me a question directly in chat!"
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("🛡️ Open Wallet", "privacy:refresh")
      .text("💬 Ask Lana", "chat:info");

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
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

    await ctx.reply("Decoding transaction with Lana AI & Helius SPR...");
    const [tx, shieldedEvents] = await Promise.all([
      deps.lanaClient.explainTransaction(signature).catch(() => null),
      privacyService.getShieldedTransactionEvents(signature).catch(() => null)
    ]);

    let privacyNotice = "";
    if (shieldedEvents && (shieldedEvents.events?.length > 0 || shieldedEvents.length > 0)) {
      const count = shieldedEvents.events?.length ?? shieldedEvents.length;
      privacyNotice = `\n\n🛡️ <b>Helius Privacy Ring Event:</b>\n• Encrypted outputs/events: <code>${count}</code>\n• UTXO commitments settled confidentially.`;
    }

    if (tx) {
      await ctx.reply(
        formatTxExplanation(tx.summary + privacyNotice, tx.tokenMovements, tx.riskNotes),
        { parse_mode: "HTML" }
      );
    } else if (privacyNotice) {
      await ctx.reply(`<b>Transaction Summary</b>${privacyNotice}`, { parse_mode: "HTML" });
    } else {
      await ctx.reply("Could not retrieve transaction details. Please check the signature.");
    }
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
    const text = [
      "<b>🤖 Lana Bot Commands Guide</b>",
      "",
      "<b>🛡️ Privacy Rings & Payments:</b>",
      "• <code>/wallet</code> — Manage private wallet & view public/private balances",
      "• <code>/deposit [amount]</code> — Shield SOL into Privacy Ring",
      "• <code>/send &lt;amount&gt; &lt;address|@username&gt;</code> — Confidential transfer",
      "• <code>/balance</code> — View encrypted & public balance",
      "• <code>/withdraw &lt;amount&gt; &lt;address&gt;</code> — Withdraw to public address",
      "• <code>/exportkey</code> — Backup your secret seed",
      "",
      "<b>🧠 Lana AI On-Chain Intelligence:</b>",
      "• <code>/chat [prompt]</code> — Ask Lana about tokens, prices, Solana programs",
      "• <code>/lookup &lt;address&gt;</code> — Address profile, risk score & tags",
      "• <code>/tx &lt;signature&gt;</code> — Explain transaction & token movements",
      "• <code>/flow &lt;address&gt; [depth]</code> — Fund flow summary",
      "• <code>/portfolio</code> — Summarize your connected wallet activity",
      "• <code>/connect &lt;address&gt;</code> — Connect an external wallet",
      "• <code>/disconnect</code> — Disconnect external wallet",
      "• <code>/clear</code> — Clear chat conversation history",
      "• <code>/stopchat</code> — Disable free-form chat mode"
    ].join("\n");

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === "chat:info") {
      await ctx.answerCallbackQuery();
      ctx.session.chatMode = true;
      await ctx.reply(
        "💬 <b>Lana Chat is active!</b> Type any question about Solana (e.g., 'What is the price of SOL?' or 'Explain Helius Privacy Rings').",
        { parse_mode: "HTML" }
      );
      return;
    }

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
      await next();
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
