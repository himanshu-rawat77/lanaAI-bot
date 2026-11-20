# Contributing to Lana Solana Intelligence & Privacy Bot

Thank you for your interest in contributing to **Lana AI & Solana Privacy Rings Bot**! We welcome contributions from developers, security researchers, and Web3 enthusiasts.

---

## 📋 Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful and constructive in all discussions, issues, and pull requests.

---

## 🛠️ Development Setup

### 1. Prerequisites
- **Node.js**: v20.x or v22.x
- **npm**: v10.x+
- **Solana CLI** (optional, for Devnet airdrops)
- **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather))
- **Helius API Key** (from [Helius Dashboard](https://dashboard.helius.dev))
- **Lana API Key**

### 2. Getting Started
1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/lanaAI-bot.git
   cd lanaAI-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up local environment:**
   ```bash
   cp .env.example .env
   ```
   Fill in your development keys in `.env`. Never commit your `.env` or any test wallet keys!

4. **Verify TypeScript compilation:**
   ```bash
   npm run typecheck
   ```

5. **Run the bot in development mode:**
   ```bash
   npm run dev
   ```

---

## 🧪 Testing on Solana Devnet

Before submitting any code changes involving Privacy Rings or Solana transactions:

1. Test self-custodial wallet generation: `/wallet`.
2. Fund with devnet SOL:
   ```bash
   solana airdrop 1 <PUBLIC_ADDRESS> --url devnet
   ```
3. Test on-chain registration: `/register`.
4. Test private shielding: `/deposit 0.1`.
5. Test balance query: `/balance`.
6. Test confidential send: `/send 0.05 <address or @username>`.
7. Test withdrawal unshielding: `/withdraw 0.05 <address>`.
8. Ensure TypeScript builds without errors:
   ```bash
   npm run build
   ```

---

## 🔒 Security Best Practices

When writing or modifying code in this repository:

1. **Zero Key Logging**: Never log private keys, owner seeds, encryption keys, or Telegram authorization tokens to `console.log`, files, or error objects.
2. **Encryption at Rest**: Any persistent key storage must go through `walletService.encrypt()` with AES-256-GCM.
3. **Chat Hygiene**: Any user message containing a private key (such as `/importkey`) must be immediately deleted from Telegram using `ctx.deleteMessage()`.
4. **Git Hygiene**: Never remove `.env` or `data/` from `.gitignore`. Always run `git status` before committing to ensure no local databases or keys are staged.

---

## 🔄 Pull Request Guidelines

1. **Create a descriptive feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Commit with conventional messages:**
   - `feat(...)`: New feature or capability
   - `fix(...)`: Bug fix
   - `docs(...)`: Documentation updates
   - `refactor(...)`: Code refactoring without behavioral changes
   - `test(...)`: Adding or updating tests

3. **Verify all checks pass before pushing:**
   ```bash
   npm run typecheck
   npm run build
   ```

4. **Open a Pull Request:**
   - Describe what the PR does and why.
   - Mention any related GitHub issues.
   - Include screenshots or terminal logs for UI / transaction changes if applicable.

---

## 💬 Community & Support

Have questions, suggestions, or found a security vulnerability?
- Open a GitHub Issue for bug reports or feature requests.
- For sensitive security disclosures, please contact the maintainers privately.
