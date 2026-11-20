import { Bot, InlineKeyboard } from "grammy";
import bs58 from "bs58";
import { ShieldedAddress } from "@heliuslabs/spr";
import type { LanaBotContext } from "../bot";
import { walletService } from "../services/wallet";
import { userDb, type WalletItem } from "../services/db";
import { privacyService, type PrivacyBalanceResult } from "../services/privacy";
import { looksLikeSolanaAddress } from "../utils/solana";
import { escapeHtml } from "../utils/format";
import { config } from "../config";

function renderWalletCard(
  publicKey: string,
  balances: PrivacyBalanceResult,
  walletLabel = "Default Bot Wallet",
  walletIndex = 1,
  totalWallets = 1
): string {
  const explorerLink = `https://explorer.solana.com/address/${publicKey}${
    config.LANA_NETWORK === "devnet" ? "?cluster=devnet" : ""
  }`;

  const shortShielded = balances.shieldedAddress
    ? `${balances.shieldedAddress.slice(0, 8)}...${balances.shieldedAddress.slice(-8)}`
    : "Initialized";

  const heliusNotice = !config.hasValidHeliusKey()
    ? "\n⚠️ <i>HELIUS_API_KEY is not configured in .env. Add your key from dashboard.helius.dev to enable live private shielding.</i>\n"
    : "";

  const multiWalletHeader =
    totalWallets > 1
      ? `<b>🛡️ Lana Private Wallet — [${escapeHtml(walletLabel)}]</b> <i>(Wallet ${walletIndex} of ${totalWallets})</i>\n`
      : `<b>🛡️ Lana Private Wallet — [${escapeHtml(walletLabel)}]</b>\n`;

  return [
    multiWalletHeader,
    "<b>🌐 Public Solana Address:</b>",
    `<code>${escapeHtml(publicKey)}</code>`,
    `<a href="${explorerLink}">View on Solana Explorer</a>`,
    "",
    "<b>🛡️ Shielded Address:</b>",
    `<code>${escapeHtml(shortShielded)}</code>`,
    "",
    "<b>💰 Balances:</b>",
    `• <b>Private (Shielded):</b> <code>${balances.privateBalanceSol.toFixed(4)} SOL</code>`,
    `• <b>Public:</b> <code>${balances.publicBalanceSol.toFixed(4)} SOL</code>`,
    heliusNotice,
    `<i>Network: ${config.LANA_NETWORK.toUpperCase()}</i>`,
    "",
    "💡 <i>Private transfers use Helius Privacy Rings — amounts and notes are confidential on-chain.</i>"
  ]
    .filter(Boolean)
    .join("\n");
}

function getWalletKeyboard(hasMultipleWallets = false): InlineKeyboard {
  return new InlineKeyboard()
    .text("📥 Deposit SOL", "privacy:deposit_info")
    .text("💸 Send Private", "privacy:send_info")
    .row()
    .text("🏧 Withdraw", "privacy:withdraw_info")
    .text("📝 Register On-Chain", "privacy:register")
    .row()
    .text("🔄 Switch Wallet", "privacy:switch_wallet")
    .text("📥 Import Phantom", "privacy:import_wallet")
    .row()
    .text("🔍 Verify/Register Other Wallet", "privacy:register_other_info")
    .row()
    .text("🔄 Refresh", "privacy:refresh")
    .text("🔑 Backup Key", "privacy:export");
}

function renderWalletSwitcher(
  wallets: WalletItem[],
  activeWalletId?: string
): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "<b>👛 Multi-Wallet Manager</b>",
    "",
    "Select which wallet to use as your <b>Main Active Wallet</b> for Privacy Rings operations (balance, deposit, send, withdraw):",
    ""
  ];

  const keyboard = new InlineKeyboard();

  wallets.forEach((w, idx) => {
    const isActive = w.id === activeWalletId;
    const indicator = isActive ? "🟢" : "⚪";
    const statusText = isActive ? " <b>(Active Main)</b>" : "";
    text.push(
      `${indicator} <b>${idx + 1}. ${escapeHtml(w.label)}</b>${statusText}`,
      `   <code>${escapeHtml(w.publicKey)}</code>`
    );

    const btnText = `${indicator} ${idx + 1}. ${w.label.slice(0, 16)} (${w.publicKey.slice(0, 4)}...)`;
    keyboard.text(btnText, `privacy:switch_to:${w.id}`).row();
  });

  text.push(
    "",
    "💡 <i>Tapping a wallet makes it your default active wallet for all transactions.</i>",
    "<i>Command shortcut:</i> <code>/switchwallet &lt;number&gt;</code>"
  );

  keyboard
    .text("📥 Import Phantom Key", "privacy:import_wallet")
    .row()
    .text("🔙 Back to Wallet Dashboard", "privacy:refresh");

  return { text: text.join("\n"), keyboard };
}

export function registerPrivacyHandlers(bot: Bot<LanaBotContext>): void {
  // /wallet: View wallet status, addresses, and balances
  bot.command("wallet", async (ctx) => {
    if (!ctx.from?.id) return;

    await ctx.reply("🔄 Loading your private wallet...");
    try {
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      ctx.session.connectedWallet = record.publicKey;

      const seed = walletService.getOwnerSeed(record);
      const balances = await privacyService.getBalances(seed, record.publicKey);

      const wallets = record.wallets || [];
      const activeWallet = walletService.getActiveWallet(ctx.from.id);
      const activeLabel = activeWallet ? activeWallet.label : "Default Bot Wallet";
      const activeIdx =
        wallets.findIndex((w) => w.id === (activeWallet?.id || record.activeWalletId)) + 1;

      const text = renderWalletCard(
        record.publicKey,
        balances,
        activeLabel,
        activeIdx || 1,
        wallets.length
      );
      const keyboard = getWalletKeyboard(wallets.length > 1);

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err: any) {
      console.error("Wallet command error:", err);
      await ctx.reply(`❌ Failed to load wallet: ${escapeHtml(err.message || String(err))}`, {
        parse_mode: "HTML"
      });
    }
  });

  // /balance: Quick balance check
  bot.command("balance", async (ctx) => {
    if (!ctx.from?.id) return;
    try {
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const seed = walletService.getOwnerSeed(record);
      const balances = await privacyService.getBalances(seed, record.publicKey);

      const text = [
        "<b>💳 Current Balance Status</b>",
        "",
        `🛡️ <b>Confidential (Shielded):</b> <code>${balances.privateBalanceSol.toFixed(4)} SOL</code>`,
        `🌐 <b>Public Solana:</b> <code>${balances.publicBalanceSol.toFixed(4)} SOL</code>`,
        "",
        `<i>Network: ${config.LANA_NETWORK.toUpperCase()}</i>`
      ].join("\n");

      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err: any) {
      console.error("Balance command error:", err);
      await ctx.reply(`❌ Error checking balance: ${escapeHtml(err.message || String(err))}`);
    }
  });

  // /deposit [amount]: Deposit SOL into Privacy Ring
  bot.command("deposit", async (ctx) => {
    if (!ctx.from?.id) return;
    const amountRaw = ctx.match?.toString().trim();

    try {
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const publicBalance = await privacyService.getPublicBalance(record.publicKey);

      if (!amountRaw) {
        const text = [
          "<b>📥 Deposit SOL into Privacy Ring</b>",
          "",
          "To shield funds, your wallet's public address must first hold SOL:",
          `<code>${escapeHtml(record.publicKey)}</code>`,
          "",
          `Current Public Balance: <b>${publicBalance.toFixed(4)} SOL</b>`,
          "",
          "<b>Options:</b>",
          "• Send SOL to the address above (via your Phantom/Solflare wallet or devnet faucet)",
          "• Once funded, run <code>/deposit &lt;amount&gt;</code> or click a button below to shield it into the private ring:"
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text("Shield 0.05 SOL", "deposit:quick:0.05")
          .text("Shield 0.1 SOL", "deposit:quick:0.1")
          .row()
          .text("Shield 0.5 SOL", "deposit:quick:0.5")
          .text("Shield 1.0 SOL", "deposit:quick:1.0");

        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
        return;
      }

      const amount = parseFloat(amountRaw);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply("❌ Invalid amount. Usage: /deposit <amount_sol>");
        return;
      }

      const requiredSol = amount + 0.005;
      if (publicBalance < requiredSol) {
        await ctx.reply(
          `❌ Insufficient public balance (${publicBalance.toFixed(4)} SOL).\n\nYou need at least <b>${requiredSol.toFixed(4)} SOL</b> (${amount} SOL deposit + ~0.005 SOL for network fee & rent).\n\nPlease fund your wallet: <code>${escapeHtml(record.publicKey)}</code>`,
          { parse_mode: "HTML" }
        );
        return;
      }

      await ctx.reply(`⏳ Shielding <b>${amount} SOL</b> into Helius Privacy Ring...`, {
        parse_mode: "HTML"
      });

      const seed = walletService.getOwnerSeed(record);
      const result = await privacyService.deposit(seed, amount);
      const explorerUrl = privacyService.getExplorerUrl(result.signature);

      const successText = [
        "<b>✅ Deposit Successful!</b>",
        "",
        `Shielded: <b>${amount} SOL</b>`,
        `Slot: <code>${result.slot.toString()}</code>`,
        "",
        `🔗 <a href="${explorerUrl}">View Deposit Transaction</a>`,
        "",
        "Your funds are now shielded in the private ring and ready for confidential transfer."
      ].join("\n");

      await ctx.reply(successText, { parse_mode: "HTML" });
    } catch (err: any) {
      console.error("Deposit command error:", err);
      const msg = err?.message || String(err);
      let userFriendly = msg;
      if (msg.includes("CLIENT_RPC") || msg.includes("getLatestBlockhash")) {
        userFriendly = "RPC connection issue with Helius endpoint. Please verify your Helius API key or network connection.";
      } else if (msg.includes("WALLET_BUILD_DEPOSIT")) {
        userFriendly = "Failed to build deposit transaction. Ensure your wallet has enough SOL to cover the deposit plus network fees.";
      }
      await ctx.reply(`❌ Deposit failed: ${escapeHtml(userFriendly)}`, {
        parse_mode: "HTML"
      });
    }
  });

  // /send <amount> <recipient>: Confidential transfer
  bot.command("send", async (ctx) => {
    if (!ctx.from?.id) return;
    const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (parts.length < 2) {
      await ctx.reply(
        "Usage: <code>/send &lt;amount&gt; &lt;solana_address or @telegram_username&gt;</code>\nExample: <code>/send 0.05 @friend</code> or <code>/send 0.1 7xKX...</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const [amountStr, recipientInput] = parts;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Please specify a valid amount of SOL.");
      return;
    }

    try {
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const seed = walletService.getOwnerSeed(record);
      const balances = await privacyService.getBalances(seed, record.publicKey);

      if (balances.privateBalanceSol < amount) {
        await ctx.reply(
          `❌ Insufficient shielded private balance (${balances.privateBalanceSol.toFixed(4)} SOL). Use /deposit to add funds first.`
        );
        return;
      }

      let recipientAddress = "";
      let recipientDisplay = recipientInput;

      if (recipientInput.startsWith("@")) {
        const username = recipientInput.replace(/^@/, "");
        const targetAddress = walletService.getAddressByUsername(username);
        if (!targetAddress) {
          await ctx.reply(
            `❌ User @${escapeHtml(username)} hasn't started the bot or linked a wallet yet. Please send to their Solana address directly.`
          );
          return;
        }
        recipientAddress = targetAddress;
        recipientDisplay = `@${username} (<code>${escapeHtml(targetAddress.slice(0, 6))}...${escapeHtml(targetAddress.slice(-4))}</code>)`;
      } else if (looksLikeSolanaAddress(recipientInput)) {
        recipientAddress = recipientInput;
        recipientDisplay = `<code>${escapeHtml(recipientInput)}</code>`;
      } else if (recipientInput.length > 50) {
        // If user entered a Base58 Shielded Address (96 bytes)
        try {
          const decoded = bs58.decode(recipientInput);
          if (decoded.length === 96) {
            const parsedShielded = ShieldedAddress.fromBytes(decoded);
            const resolvedPublic = parsedShielded.solanaAddress();
            recipientAddress = resolvedPublic;
            recipientDisplay = `<code>${escapeHtml(resolvedPublic)}</code> (Extracted from Shielded Address)`;
          } else {
            await ctx.reply(
              "❌ Invalid address length. Please use a standard public Solana address or @telegram_username."
            );
            return;
          }
        } catch {
          await ctx.reply("❌ Invalid address format. Please use a public Solana address or @telegram_username.");
          return;
        }
      } else {
        await ctx.reply(
          "❌ Recipient must be a valid Solana public address, Shielded address, or @telegram_username."
        );
        return;
      }

      const isRegistered = await privacyService.isAddressRegistered(recipientAddress);

      ctx.session.pendingConfirmation = {
        type: "send",
        amountSol: amount,
        recipientAddress,
        recipientDisplay,
        timestamp: Date.now()
      };

      if (isRegistered) {
        const confirmText = [
          "<b>🛡️ Confirm Confidential Transfer</b>",
          "",
          `• <b>Amount:</b> <code>${amount} SOL</code>`,
          `• <b>Recipient:</b> ${recipientDisplay}`,
          `• <b>Transfer Mode:</b> 🛡️ <i>Private-to-Private Shielded Ring</i>`,
          `• <b>Status:</b> ✅ Recipient has a registered Private Wallet`,
          `• <b>Network:</b> ${config.LANA_NETWORK.toUpperCase()}`,
          "",
          "🔒 <i>Transfer amount and UTXOs are encrypted on-chain. Sender & recipient remain private within the ring.</i>"
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text("🛡️ Confirm Confidential Send", "privacy_confirm:send")
          .text("❌ Cancel", "privacy_confirm:cancel");

        await ctx.reply(confirmText, { parse_mode: "HTML", reply_markup: keyboard });
      } else {
        // Recipient is not registered in Privacy Rings.
        // As recommended by Helius Privacy docs: ask sender for explicit confirmation
        // so nobody unshields or withdraws to a public balance by accident!
        const confirmText = [
          "<b>⚠️ Public Withdrawal Confirmation Required</b>",
          "",
          `The recipient ${recipientDisplay} does <b>not</b> have a registered Private Wallet in the Privacy Ring.`,
          "",
          `To complete this payment, the funds will be <b>unshielded from your private balance</b> and transferred directly to their public Solana address.`,
          "",
          `• <b>Amount to Unshield:</b> <code>${amount} SOL</code>`,
          `• <b>Public Destination:</b> ${recipientDisplay}`,
          `• <b>Network:</b> ${config.LANA_NETWORK.toUpperCase()}`,
          "",
          "⚠️ <b>Privacy Notice:</b> <i>This transaction will be visible on the public Solana ledger.</i>",
          "",
          "Do you authorize this public withdrawal?"
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text(`🌐 Authorize Public Withdrawal (${amount} SOL)`, "privacy_confirm:send")
          .row()
          .text("❌ Cancel Transfer", "privacy_confirm:cancel");

        await ctx.reply(confirmText, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err: any) {
      console.error("Send command error:", err);
      await ctx.reply(`❌ Send setup error: ${escapeHtml(err.message || String(err))}`);
    }
  });

  // /withdraw <amount> <public_address>: Withdraw private balance to public address
  bot.command("withdraw", async (ctx) => {
    if (!ctx.from?.id) return;
    const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (parts.length < 2) {
      await ctx.reply("Usage: <code>/withdraw &lt;amount&gt; &lt;public_solana_address&gt;</code>", {
        parse_mode: "HTML"
      });
      return;
    }

    const [amountStr, targetAddress] = parts;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Please specify a valid amount of SOL.");
      return;
    }

    if (!looksLikeSolanaAddress(targetAddress)) {
      await ctx.reply("❌ Invalid destination Solana public address.");
      return;
    }

    try {
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const seed = walletService.getOwnerSeed(record);
      const balances = await privacyService.getBalances(seed, record.publicKey);

      if (balances.privateBalanceSol < amount) {
        await ctx.reply(
          `❌ Insufficient shielded private balance (${balances.privateBalanceSol.toFixed(4)} SOL).`
        );
        return;
      }

      ctx.session.pendingConfirmation = {
        type: "withdraw",
        amountSol: amount,
        recipientAddress: targetAddress,
        recipientDisplay: `<code>${escapeHtml(targetAddress)}</code>`,
        timestamp: Date.now()
      };

      const confirmText = [
        "<b>🏧 Confirm Withdrawal</b>",
        "",
        "You are about to unshield funds from the Privacy Ring to a public address:",
        `• <b>Amount:</b> <code>${amount} SOL</code>`,
        `• <b>Destination:</b> <code>${escapeHtml(targetAddress)}</code>`,
        `• <b>Network:</b> ${config.LANA_NETWORK.toUpperCase()}`,
        "",
        "⚠️ <i>Once withdrawn, this balance is visible on public Solana ledger.</i>"
      ].join("\n");

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm Withdraw", "privacy_confirm:withdraw")
        .text("❌ Cancel", "privacy_confirm:cancel");

      await ctx.reply(confirmText, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err: any) {
      console.error("Withdraw command error:", err);
      await ctx.reply(`❌ Withdraw setup error: ${escapeHtml(err.message || String(err))}`);
    }
  });

  // /exportkey: Backup private key
  bot.command("exportkey", async (ctx) => {
    if (!ctx.from?.id) return;
    try {
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const base58Seed = walletService.exportSeedBase58(record);
      const hexSeed = walletService.exportSeedHex(record);

      const text = [
        "<b>🔐 Secret Seed & Private Key Backup</b>",
        "",
        "⚠️ <b>WARNING: NEVER SHARE YOUR SECRET SEED WITH ANYONE!</b>",
        "Anyone who has this seed controls your funds.",
        "",
        "<b>Base58 Seed:</b>",
        `<code>${escapeHtml(base58Seed)}</code>`,
        "",
        "<b>Hex Seed:</b>",
        `<code>${escapeHtml(hexSeed)}</code>`,
        "",
        "<i>Delete this message after saving your backup securely.</i>"
      ].join("\n");

      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err: any) {
      await ctx.reply(`❌ Error exporting key: ${escapeHtml(err.message || String(err))}`);
    }
  });

  // Helper to handle registration & verification for a given target (address or @username)
  async function handleRegisterTarget(ctx: any, targetInput: string) {
    let targetAddress = targetInput;
    let displayName = targetInput;
    let internalRecord = null;

    if (targetInput.startsWith("@")) {
      const cleanUser = targetInput.replace(/^@/, "");
      internalRecord = userDb.getUserByUsername(cleanUser);
      if (!internalRecord) {
        await ctx.reply(
          `❌ User @${escapeHtml(cleanUser)} has not started the bot or linked a wallet yet.`
        );
        return;
      }
      targetAddress = internalRecord.publicKey;
      displayName = `@${cleanUser} (<code>${escapeHtml(targetAddress.slice(0, 6))}...${escapeHtml(targetAddress.slice(-4))}</code>)`;
    } else if (looksLikeSolanaAddress(targetInput)) {
      internalRecord = userDb.getUserByPublicKey(targetInput);
      displayName = `<code>${escapeHtml(targetInput)}</code>`;
    } else {
      await ctx.reply(
        "❌ Invalid argument. Usage:\n• <code>/register</code> — Register your own wallet\n• <code>/register &lt;solana_address or @username&gt;</code> — Verify or register another wallet",
        { parse_mode: "HTML" }
      );
      return;
    }

    // If it's a wallet generated/stored in this bot, we can register it or show its status
    if (internalRecord) {
      const seed = walletService.getOwnerSeed(internalRecord);
      await ctx.reply(`🔍 Checking registration status for ${displayName}...`, { parse_mode: "HTML" });
      const status = await privacyService.getRegistrationStatus(seed);

      if (status.isRegistered) {
        const text = [
          "<b>🛡️ Solana Privacy Rings — Registration Status</b>",
          "",
          "✅ <b>Wallet is Active & Registered On-Chain!</b>",
          "",
          `• <b>Owner:</b> ${displayName}`,
          `• <b>Shielded Address:</b> <code>${escapeHtml(status.shieldedAddress)}</code>`,
          `• <b>Merge Scheme:</b> <code>PoseidonCtrV1</code>`,
          `• <b>Network:</b> ${config.LANA_NETWORK.toUpperCase()}`,
          "",
          "💡 <i>You can send private SOL to this wallet confidentially:</i>",
          `<code>/send 0.1 ${escapeHtml(targetInput)}</code>`
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text("💸 Send Private SOL", "privacy:send_info")
          .text("🛡️ Wallet Dashboard", "privacy:refresh");

        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
        return;
      }

      // Not registered yet, but we control the keys
      const publicBal = await privacyService.getPublicBalance(targetAddress);
      if (publicBal < 0.003) {
        await ctx.reply(
          `⚠️ <b>Registration Gas Needed:</b>\n\nWallet ${displayName} needs at least <b>0.003 SOL</b> for on-chain rent (~100 bytes).\nCurrent balance: <b>${publicBal.toFixed(4)} SOL</b>.\n\nPlease fund with devnet SOL, then run <code>/register ${escapeHtml(targetInput)}</code> again.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      await ctx.reply(`⏳ Registering wallet ${displayName} on Solana Privacy Rings...`, { parse_mode: "HTML" });
      const result = await privacyService.registerWallet(seed);
      const explorerUrl = result.signature ? privacyService.getExplorerUrl(result.signature) : "";

      const text = [
        "<b>🎉 Wallet Registered On-Chain!</b>",
        "",
        `• <b>Owner:</b> ${displayName}`,
        `• <b>Shielded Address:</b> <code>${escapeHtml(result.shieldedAddress)}</code>`,
        `• <b>Scheme:</b> <code>PoseidonCtrV1</code>`,
        result.slot ? `• <b>Slot:</b> <code>${result.slot.toString()}</code>` : "",
        result.signature ? `\n🔗 <a href="${explorerUrl}">View on Solana Explorer</a>` : "",
        "",
        "🛡️ <i>The wallet is now registered in the Privacy Rings network and ready for confidential transfers!</i>"
      ].filter(Boolean).join("\n");

      await ctx.reply(text, { parse_mode: "HTML" });
      return;
    }

    // External address (not created in this bot)
    await ctx.reply(`🔍 Querying on-chain Privacy Rings registry for <code>${escapeHtml(targetAddress)}</code>...`, {
      parse_mode: "HTML"
    });
    const isRegistered = await privacyService.isAddressRegistered(targetAddress);

    if (isRegistered) {
      const text = [
        "<b>🛡️ Solana Privacy Rings — Registration Record</b>",
        "",
        "✅ <b>Address is Active & Registered On-Chain!</b>",
        "",
        `• <b>Solana Address:</b> <code>${escapeHtml(targetAddress)}</code>`,
        `• <b>Registry Status:</b> Verified on Solana Privacy Rings Registry`,
        `• <b>Capabilities:</b> Can receive confidential private transfers directly!`,
        "",
        "💡 <i>You can send private SOL to this address right now using:</i>",
        `<code>/send &lt;amount&gt; ${escapeHtml(targetAddress)}</code>`
      ].join("\n");

      const keyboard = new InlineKeyboard()
        .text("💸 Send Private", "privacy:send_info")
        .text("🛡️ Open Wallet", "privacy:refresh");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    } else {
      const text = [
        "<b>🔍 Privacy Rings Registry Lookup</b>",
        "",
        "⚠️ <b>Wallet is NOT Registered in Privacy Rings</b>",
        "",
        `• <b>Target Address:</b> <code>${escapeHtml(targetAddress)}</code>`,
        "",
        "<b>🔐 Why must the owner sign?</b>",
        "Under the Solana Privacy Rings protocol, registering an address creates an immutable cryptographic mapping between the Solana address and a <b>Private Viewing Key</b>.",
        "",
        "To prevent an attacker from registering another person's public address with a malicious viewing key (which would hijack their confidential payments), the on-chain Solana Privacy Program strictly requires the <b>private key owner of that address</b> to sign the registration instruction.",
        "",
        "<b>What you can do:</b>",
        `• <b>Send anyway:</b> Run <code>/send &lt;amount&gt; ${escapeHtml(targetAddress)}</code>. The bot will automatically unshield and deliver it as a public Solana transfer.`,
        `• <b>Invite the owner:</b> Ask the wallet owner to open this bot and run <code>/register</code> to activate their private wallet.`
      ].join("\n");

      await ctx.reply(text, { parse_mode: "HTML" });
    }
  }

  // Helper to import Phantom / Solflare private key and derive shielded keypair
  async function handleImportPrivateKey(ctx: any, privateKeyInput: string) {
    if (!ctx.from?.id) return;

    await ctx.reply("⏳ Validating key & deriving Shielded Keypair on Solana Privacy Rings...");
    try {
      const { record, wallet, isNew } = await walletService.importWallet(
        ctx.from.id,
        privateKeyInput,
        undefined,
        ctx.from.username
      );
      ctx.session.connectedWallet = wallet.publicKey;

      const seed = walletService.getOwnerSeed(record);
      const balances = await privacyService.getBalances(seed, wallet.publicKey);
      const wallets = record.wallets || [];
      const walletIdx = wallets.findIndex((w) => w.id === wallet.id) + 1;

      const title = isNew
        ? "<b>🎉 Phantom Wallet Connected & Imported!</b>"
        : "<b>✅ Wallet Already Imported — Switched to Active!</b>";

      const text = [
        title,
        "",
        `• <b>Label:</b> <code>${escapeHtml(wallet.label)}</code>`,
        `• <b>Solana Address:</b> <code>${escapeHtml(wallet.publicKey)}</code>`,
        `• <b>Shielded Address:</b> <code>${escapeHtml(balances.shieldedAddress || "Derived")}</code>`,
        `• <b>Status:</b> 🟢 <b>Set as Main Active Wallet</b>`,
        "",
        "<b>💰 Balances:</b>",
        `• <b>Public Balance:</b> <code>${balances.publicBalanceSol.toFixed(4)} SOL</code>`,
        `• <b>Private (Shielded):</b> <code>${balances.privateBalanceSol.toFixed(4)} SOL</code>`,
        "",
        "💡 <i>Your Phantom wallet is now your main active wallet. All /send, /deposit, /withdraw, and /wallet commands operate on this wallet!</i>",
        "",
        "<i>Use <code>/switchwallet</code> or the Switch Wallet button anytime to toggle between wallets.</i>"
      ].join("\n");

      const keyboard = getWalletKeyboard(wallets.length > 1);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err: any) {
      console.error("Import key error:", err);
      await ctx.reply(
        `❌ <b>Failed to import wallet:</b> ${escapeHtml(err.message || String(err))}\n\nPlease check your private key format and try again.`,
        { parse_mode: "HTML" }
      );
    }
  }

  // Intercept text messages if user is awaiting input
  bot.on("message:text", async (ctx, next) => {
    if (ctx.session?.awaitingImportKey) {
      ctx.session.awaitingImportKey = false;
      const text = ctx.message.text.trim();

      // Immediately delete user's message containing the private key for security
      try {
        await ctx.deleteMessage();
      } catch {}

      if (!text.startsWith("/")) {
        await handleImportPrivateKey(ctx, text);
        return;
      }
    }

    if (ctx.session?.awaitingRegistrationInput) {
      const text = ctx.message.text.trim();
      ctx.session.awaitingRegistrationInput = false;
      if (!text.startsWith("/")) {
        try {
          await handleRegisterTarget(ctx, text);
        } catch (err: any) {
          console.error("Interactive register error:", err);
          await ctx.reply(`❌ Registration check failed: ${escapeHtml(err.message || String(err))}`);
        }
        return;
      }
    }
    await next();
  });

  // /importkey or /importwallet: Import Phantom/external private key
  bot.command(["importkey", "importwallet"], async (ctx) => {
    if (!ctx.from?.id) return;
    const keyInput = ctx.match?.toString().trim();

    // Auto-delete user's message containing key for security
    try {
      await ctx.deleteMessage();
    } catch {}

    if (!keyInput) {
      ctx.session.awaitingImportKey = true;
      const text = [
        "<b>📥 Import Phantom / Solflare Private Key</b>",
        "",
        "Please reply to this message with your <b>Base58 Private Key</b> from Phantom (<code>Settings ➔ Manage Accounts ➔ Export Private Key</code>).",
        "",
        "🔒 <b>Security & Privacy Guarantee:</b>",
        "• Your key is encrypted at rest using <b>AES-256-GCM</b>.",
        "• <b>Your reply message will be deleted automatically upon receipt</b> to keep it out of Telegram chat history.",
        "• A corresponding <b>Shielded Keypair</b> on Solana Privacy Rings will be derived."
      ].join("\n");

      const keyboard = new InlineKeyboard().text("❌ Cancel", "privacy:cancel_input");
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    await handleImportPrivateKey(ctx, keyInput);
  });

  // /switchwallet [1 | 2 | address]: Switch active wallet
  bot.command("switchwallet", async (ctx) => {
    if (!ctx.from?.id) return;
    const target = ctx.match?.toString().trim();
    const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
    const wallets = record.wallets || [];

    if (target) {
      try {
        const { activeWallet } = walletService.switchActiveWallet(ctx.from.id, target);
        ctx.session.connectedWallet = activeWallet.publicKey;

        const seed = walletService.getOwnerSeed(record);
        const balances = await privacyService.getBalances(seed, activeWallet.publicKey);
        const activeIdx = wallets.findIndex((w) => w.id === activeWallet.id) + 1;

        const text = [
          `✅ <b>Active Wallet Switched to: ${escapeHtml(activeWallet.label)}</b>\n`,
          renderWalletCard(
            activeWallet.publicKey,
            balances,
            activeWallet.label,
            activeIdx || 1,
            wallets.length
          )
        ].join("\n");

        const keyboard = getWalletKeyboard(wallets.length > 1);
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      } catch (err: any) {
        await ctx.reply(`❌ ${escapeHtml(err.message || String(err))}`);
      }
      return;
    }

    const { text, keyboard } = renderWalletSwitcher(wallets, record.activeWalletId);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  });

  // /register [address | @username]: Advanced on-chain registration & verification
  bot.command("register", async (ctx) => {
    if (!ctx.from?.id) return;
    const targetInput = ctx.match?.toString().trim();

    try {
      // If user passed a specific wallet address or @username
      if (targetInput) {
        await handleRegisterTarget(ctx, targetInput);
        return;
      }

      // No argument provided — Self registration for current user's wallet
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const seed = walletService.getOwnerSeed(record);

      await ctx.reply("🔍 Checking on-chain Privacy Rings registry status...");
      const status = await privacyService.getRegistrationStatus(seed);

      if (status.isRegistered) {
        const text = [
          "<b>🛡️ Solana Privacy Rings — Registration Status</b>",
          "",
          "✅ <b>Your Wallet is Active & Registered On-Chain!</b>",
          "",
          `• <b>Public Solana Owner:</b>`,
          `<code>${escapeHtml(status.publicKey)}</code>`,
          "",
          `• <b>Shielded Address (Confidential):</b>`,
          `<code>${escapeHtml(status.shieldedAddress)}</code>`,
          "",
          `• <b>Nullifier Public Key:</b> <code>${escapeHtml(status.nullifierPublicKey.slice(0, 16))}...</code>`,
          `• <b>Viewing Public Key:</b> <code>${escapeHtml(status.viewingPublicKey.slice(0, 16))}...</code>`,
          `• <b>Merge Scheme:</b> <code>PoseidonCtrV1</code>`,
          `• <b>Network:</b> ${config.LANA_NETWORK.toUpperCase()}`,
          "",
          "💡 <i>Your wallet is discoverable in the Privacy Rings network. Other bots and users can send confidential transfers directly to your address without unshielding!</i>"
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text("📥 Deposit SOL", "privacy:deposit_info")
          .text("💸 Send Private", "privacy:send_info")
          .row()
          .text("🛡️ Open Wallet", "privacy:refresh");

        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
        return;
      }

      // Not registered yet. Check public balance for rent and fees
      const publicBal = await privacyService.getPublicBalance(record.publicKey);
      const minRequired = 0.003;

      if (publicBal < minRequired) {
        const text = [
          "<b>📝 On-Chain Private Wallet Registration</b>",
          "",
          "Creating an on-chain registration PDA maps your Solana address to your Shielded Address in the Privacy Ring registry.",
          "",
          "⚠️ <b>Rent & Fees Required:</b>",
          `Your public wallet needs at least <b>${minRequired} SOL</b> for the on-chain account rent (~100 bytes) and Solana network fee.`,
          "",
          `Current Public Balance: <b>${publicBal.toFixed(4)} SOL</b>`,
          "",
          "<b>To proceed:</b>",
          `1. Fund your public address with devnet SOL:`,
          `<code>${escapeHtml(record.publicKey)}</code>`,
          `2. Run <code>/register</code> again or click the button below.`
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text("🔄 Re-check Balance & Register", "privacy:register_submit")
          .text("🛡️ Wallet Dashboard", "privacy:refresh");

        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
        return;
      }

      // Ready to register
      const promptText = [
        "<b>📝 Register Private Wallet On-Chain</b>",
        "",
        "You are about to register your wallet in the Solana Privacy Rings registry:",
        `• <b>Owner:</b> <code>${escapeHtml(status.publicKey)}</code>`,
        `• <b>Shielded Address:</b> <code>${escapeHtml(status.shieldedAddress.slice(0, 10))}...${escapeHtml(status.shieldedAddress.slice(-10))}</code>`,
        `• <b>Merge Encryption Scheme:</b> <code>PoseidonCtrV1</code>`,
        `• <b>Estimated Cost:</b> ~0.0016 SOL (refundable account rent)`,
        "",
        "<i>Once registered, other users can transfer private SOL directly into your confidential balance.</i>"
      ].join("\n");

      const keyboard = new InlineKeyboard()
        .text("🚀 Submit On-Chain Registration", "privacy:register_submit")
        .text("❌ Cancel", "privacy_confirm:cancel");

      await ctx.reply(promptText, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err: any) {
      console.error("Register command error:", err);
      await ctx.reply(`❌ Register error: ${escapeHtml(err.message || String(err))}`);
    }
  });

  // Callback query handlers
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === "privacy:refresh") {
      await ctx.answerCallbackQuery({ text: "Refreshing balances..." });
      if (!ctx.from?.id) return;
      try {
        const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
        const seed = walletService.getOwnerSeed(record);
        const balances = await privacyService.getBalances(seed, record.publicKey);

        const wallets = record.wallets || [];
        const activeWallet = walletService.getActiveWallet(ctx.from.id);
        const activeLabel = activeWallet ? activeWallet.label : "Default Bot Wallet";
        const activeIdx =
          wallets.findIndex((w) => w.id === (activeWallet?.id || record.activeWalletId)) + 1;

        const text = renderWalletCard(
          record.publicKey,
          balances,
          activeLabel,
          activeIdx || 1,
          wallets.length
        );
        const keyboard = getWalletKeyboard(wallets.length > 1);

        try {
          await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
        } catch (editErr: any) {
          // Ignore Telegram error when user taps refresh and content is identical
          if (!editErr?.description?.includes("message is not modified")) {
            console.error("Refresh editMessageText error:", editErr);
          }
        }
      } catch (err) {
        console.error("Refresh callback error:", err);
      }
      return;
    }

    if (data === "privacy:switch_wallet") {
      await ctx.answerCallbackQuery();
      if (!ctx.from?.id) return;
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const wallets = record.wallets || [];
      const { text, keyboard } = renderWalletSwitcher(wallets, record.activeWalletId);
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
      } catch {
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("privacy:switch_to:")) {
      const targetId = data.slice("privacy:switch_to:".length);
      await ctx.answerCallbackQuery({ text: "Switching active wallet..." });
      if (!ctx.from?.id) return;
      try {
        const { record, activeWallet } = walletService.switchActiveWallet(ctx.from.id, targetId);
        ctx.session.connectedWallet = activeWallet.publicKey;

        const seed = walletService.getOwnerSeed(record);
        const balances = await privacyService.getBalances(seed, activeWallet.publicKey);
        const wallets = record.wallets || [];
        const activeIdx = wallets.findIndex((w) => w.id === activeWallet.id) + 1;

        const text = [
          `✅ <b>Active Wallet Switched to: ${escapeHtml(activeWallet.label)}</b>\n`,
          renderWalletCard(
            activeWallet.publicKey,
            balances,
            activeWallet.label,
            activeIdx || 1,
            wallets.length
          )
        ].join("\n");

        const keyboard = getWalletKeyboard(wallets.length > 1);
        try {
          await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
        } catch {
          await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
        }
      } catch (err: any) {
        await ctx.reply(`❌ Failed to switch wallet: ${escapeHtml(err.message || String(err))}`);
      }
      return;
    }

    if (data === "privacy:import_wallet") {
      await ctx.answerCallbackQuery();
      ctx.session.awaitingImportKey = true;
      const text = [
        "<b>📥 Connect / Import Phantom Private Key</b>",
        "",
        "Please reply with your <b>Base58 Private Key</b> from Phantom or Solflare:",
        "",
        "<b>📌 How to export from Phantom:</b>",
        "1. Open Phantom ➔ Settings ⚙️",
        "2. Select <b>Manage Accounts</b>",
        "3. Select your Solana wallet account",
        "4. Click <b>Show Private Key</b> and copy it",
        "",
        "🔒 <b>Security & Privacy Guarantee:</b>",
        "• Your key is encrypted at rest using <b>AES-256-GCM</b>.",
        "• <b>Your message containing the key will be deleted automatically immediately</b> to keep it out of Telegram chat history.",
        "• A corresponding <b>Shielded Keypair</b> on Solana Privacy Rings will be derived for private confidential transfers.",
        "",
        "<i>Or send command directly:</i>",
        "<code>/importkey &lt;base58_private_key&gt;</code>"
      ].join("\n");

      const keyboard = new InlineKeyboard().text("❌ Cancel", "privacy:cancel_input");
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    if (data === "privacy:deposit_info") {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "To deposit SOL into the Privacy Ring:\n1. Fund your public address (shown in /wallet)\n2. Run <code>/deposit &lt;amount&gt;</code> to shield it.",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data === "privacy:send_info") {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "To send private SOL:\nRun <code>/send &lt;amount&gt; &lt;recipient_address or @username&gt;</code>\nExample: <code>/send 0.05 @friend</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data === "privacy:withdraw_info") {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "To withdraw back to a public address:\nRun <code>/withdraw &lt;amount&gt; &lt;public_solana_address&gt;</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data === "privacy:export") {
      await ctx.answerCallbackQuery();
      if (!ctx.from?.id) return;
      const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
      const base58Seed = walletService.exportSeedBase58(record);
      await ctx.reply(
        `🔐 <b>Private Key Backup:</b>\n<code>${escapeHtml(base58Seed)}</code>\n\n<i>Keep this confidential!</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (data === "privacy:register_other_info") {
      await ctx.answerCallbackQuery();
      ctx.session.awaitingRegistrationInput = true;
      const text = [
        "<b>🔍 Verify or Register Another Wallet</b>",
        "",
        "Please reply with the <b>Solana public address</b> (e.g. <code>9SJh...</code>) or Telegram <b>@username</b> you want to verify or register on Privacy Rings.",
        "",
        "• <b>Telegram Users (@username):</b> If they use this bot, we can verify or register their private wallet on-chain.",
        "• <b>External Solana Addresses:</b> We will verify their on-chain Privacy Rings registry status.",
        "",
        "<i>Or send command directly:</i>",
        "<code>/register &lt;address or @username&gt;</code>"
      ].join("\n");

      const keyboard = new InlineKeyboard().text("❌ Cancel", "privacy:cancel_input");
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    if (data === "privacy:cancel_input") {
      await ctx.answerCallbackQuery({ text: "Cancelled" });
      ctx.session.awaitingRegistrationInput = false;
      ctx.session.awaitingImportKey = false;
      try {
        await ctx.editMessageText("❌ Operation cancelled.");
      } catch {}
      return;
    }

    if (data === "privacy:register" || data === "privacy:register_submit") {
      await ctx.answerCallbackQuery({ text: "Checking on-chain registry..." });
      if (!ctx.from?.id) return;
      try {
        const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
        const seed = walletService.getOwnerSeed(record);
        const status = await privacyService.getRegistrationStatus(seed);

        if (status.isRegistered) {
          const text = [
            "<b>🛡️ Solana Privacy Rings — Registration Status</b>",
            "",
            "✅ <b>Your Wallet is Active & Registered On-Chain!</b>",
            "",
            `• <b>Owner:</b> <code>${escapeHtml(status.publicKey)}</code>`,
            `• <b>Shielded Address:</b> <code>${escapeHtml(status.shieldedAddress)}</code>`,
            `• <b>Scheme:</b> <code>PoseidonCtrV1</code>`,
            "",
            "💡 <i>Your wallet is discoverable on-chain. Anyone can send you confidential private transfers without unshielding!</i>"
          ].join("\n");

          const keyboard = new InlineKeyboard()
            .text("📥 Deposit SOL", "privacy:deposit_info")
            .text("💸 Send Private", "privacy:send_info")
            .row()
            .text("🛡️ Open Wallet", "privacy:refresh");

          await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
          return;
        }

        const publicBal = await privacyService.getPublicBalance(record.publicKey);
        const minRequired = 0.003;

        if (publicBal < minRequired) {
          await ctx.reply(
            `⚠️ <b>Account Rent / Gas Required</b>\n\nCreating the user record PDA on Solana requires ~100 bytes of account rent (~0.002 SOL).\n\nYour address <code>${escapeHtml(record.publicKey)}</code> has <b>${publicBal.toFixed(4)} SOL</b>.\nPlease fund at least <b>${minRequired} SOL</b>, then try again.`,
            { parse_mode: "HTML" }
          );
          return;
        }

        await ctx.reply("⏳ Building registration transaction & enabling PoseidonCtrV1 merge encryption...");
        const result = await privacyService.registerWallet(seed);

        if (result.alreadyRegistered) {
          await ctx.reply(
            "<b>✅ Already Registered!</b>\n\nYour wallet is already active in the Solana Privacy Rings registry.",
            { parse_mode: "HTML" }
          );
          return;
        }

        const explorerUrl = result.signature
          ? privacyService.getExplorerUrl(result.signature)
          : "";

        const successText = [
          "<b>🎉 Private Wallet Registered On-Chain!</b>",
          "",
          `• <b>Public Solana Owner:</b> <code>${escapeHtml(result.publicKey)}</code>`,
          `• <b>Shielded Address:</b> <code>${escapeHtml(result.shieldedAddress)}</code>`,
          `• <b>Encryption Scheme:</b> <code>PoseidonCtrV1</code>`,
          result.slot ? `• <b>Slot:</b> <code>${result.slot.toString()}</code>` : "",
          result.signature ? `\n🔗 <a href="${explorerUrl}">View Registration on Solana Explorer</a>` : "",
          "",
          "🛡️ <i>Your wallet is now registered in the Solana Privacy Rings registry. Anyone can send confidential transfers directly to you!</i>"
        ]
          .filter(Boolean)
          .join("\n");

        const keyboard = new InlineKeyboard()
          .text("📥 Deposit SOL", "privacy:deposit_info")
          .text("💸 Send Private", "privacy:send_info")
          .row()
          .text("🛡️ Open Wallet", "privacy:refresh");

        await ctx.reply(successText, { parse_mode: "HTML", reply_markup: keyboard });
      } catch (err: any) {
        console.error("Register callback error:", err);
        await ctx.reply(`❌ Registration error: ${escapeHtml(err.message || String(err))}`);
      }
      return;
    }

    if (data.startsWith("deposit:quick:")) {
      const amountStr = data.slice("deposit:quick:".length);
      const amount = parseFloat(amountStr);
      await ctx.answerCallbackQuery({ text: `Processing deposit of ${amount} SOL...` });
      if (!ctx.from?.id) return;

      try {
        const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
        const publicBalance = await privacyService.getPublicBalance(record.publicKey);
        const requiredSol = amount + 0.005;

        if (publicBalance < requiredSol) {
          await ctx.reply(
            `❌ Insufficient public balance (${publicBalance.toFixed(4)} SOL).\n\nYou need at least <b>${requiredSol.toFixed(4)} SOL</b> (${amount} SOL deposit + ~0.005 SOL for network fee & rent).\n\nPlease send devnet SOL to your wallet: <code>${escapeHtml(record.publicKey)}</code>`,
            { parse_mode: "HTML" }
          );
          return;
        }

        const seed = walletService.getOwnerSeed(record);
        await ctx.reply(`⏳ Shielding <b>${amount} SOL</b> into Helius Privacy Ring...`, {
          parse_mode: "HTML"
        });
        const result = await privacyService.deposit(seed, amount);
        const explorerUrl = privacyService.getExplorerUrl(result.signature);
        await ctx.reply(
          `✅ <b>Deposit Successful!</b>\n\nShielded: <b>${amount} SOL</b>\n🔗 <a href="${explorerUrl}">View on Explorer</a>`,
          { parse_mode: "HTML" }
        );
      } catch (err: any) {
        const msg = err?.message || String(err);
        let userFriendly = msg;
        if (msg.includes("CLIENT_RPC") || msg.includes("getLatestBlockhash")) {
          userFriendly = "RPC connection issue with Helius endpoint. Please verify your Helius API key or network connection.";
        } else if (msg.includes("WALLET_BUILD_DEPOSIT")) {
          userFriendly = "Failed to build deposit transaction. Ensure your wallet has enough SOL for the deposit and network fees.";
        }
        await ctx.reply(`❌ Deposit error: ${escapeHtml(userFriendly)}`, {
          parse_mode: "HTML"
        });
      }
      return;
    }

    if (data === "privacy_confirm:cancel") {
      ctx.session.pendingConfirmation = undefined;
      await ctx.answerCallbackQuery({ text: "Action cancelled" });
      await ctx.editMessageText("❌ Operation cancelled.");
      return;
    }

    if (data === "privacy_confirm:send") {
      await ctx.answerCallbackQuery();
      const pending = ctx.session.pendingConfirmation;
      if (!pending || pending.type !== "send") {
        await ctx.reply("❌ Transaction expired or not found. Please run /send again.");
        return;
      }
      ctx.session.pendingConfirmation = undefined;

      await ctx.editMessageText("⏳ Executing private transfer via Helius Privacy Ring...");
      if (!ctx.from?.id) return;

      try {
        const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
        const seed = walletService.getOwnerSeed(record);
        const result = await privacyService.sendPrivate(
          seed,
          pending.recipientAddress,
          pending.amountSol
        );
        const explorerUrl = privacyService.getExplorerUrl(result.signature);

        const settlementNote =
          result.transferType === "withdrawal"
            ? "🌐 <i>Settled as a Private ➔ Public transfer (funds unshielded and deposited into recipient's public Solana address).</i>"
            : "🛡️ <i>The transfer has settled confidentially within the Solana Privacy Ring (encrypted amounts).</i>";

        const receiptText = [
          "<b>✅ Transfer Complete!</b>",
          "",
          `• <b>Amount Sent:</b> <code>${pending.amountSol} SOL</code>`,
          `• <b>Recipient:</b> ${pending.recipientDisplay}`,
          `• <b>Slot:</b> <code>${result.slot.toString()}</code>`,
          "",
          `🔗 <a href="${explorerUrl}">View on Solana Explorer</a>`,
          "",
          settlementNote
        ].join("\n");

        await ctx.reply(receiptText, { parse_mode: "HTML" });
      } catch (err: any) {
        console.error("Execute send error:", err);
        await ctx.reply(`❌ Private transfer failed: ${escapeHtml(err.message || String(err))}`, {
          parse_mode: "HTML"
        });
      }
      return;
    }

    if (data === "privacy_confirm:withdraw") {
      await ctx.answerCallbackQuery();
      const pending = ctx.session.pendingConfirmation;
      if (!pending || pending.type !== "withdraw") {
        await ctx.reply("❌ Withdrawal expired. Please run /withdraw again.");
        return;
      }
      ctx.session.pendingConfirmation = undefined;

      await ctx.editMessageText("⏳ Processing withdrawal from Privacy Ring to public balance...");
      if (!ctx.from?.id) return;

      try {
        const { record } = await walletService.getOrCreateWallet(ctx.from.id, ctx.from.username);
        const seed = walletService.getOwnerSeed(record);
        const result = await privacyService.withdraw(
          seed,
          pending.recipientAddress,
          pending.amountSol
        );
        const explorerUrl = privacyService.getExplorerUrl(result.signature);

        const receiptText = [
          "<b>✅ Withdrawal Complete!</b>",
          "",
          `• <b>Amount Withdrawn:</b> <code>${pending.amountSol} SOL</code>`,
          `• <b>Destination:</b> <code>${escapeHtml(pending.recipientAddress)}</code>`,
          `• <b>Slot:</b> <code>${result.slot.toString()}</code>`,
          "",
          `🔗 <a href="${explorerUrl}">View Transaction on Solana Explorer</a>`
        ].join("\n");

        await ctx.reply(receiptText, { parse_mode: "HTML" });
      } catch (err: any) {
        console.error("Execute withdraw error:", err);
        await ctx.reply(`❌ Withdrawal failed: ${escapeHtml(err.message || String(err))}`, {
          parse_mode: "HTML"
        });
      }
      return;
    }

    await next();
  });
}
