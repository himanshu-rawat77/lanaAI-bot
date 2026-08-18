# Run On Another Device

Use this checklist when you export/copy the project to another laptop or server.

## 1) Copy Project

Copy the whole project folder, including:

- `package.json` and `package-lock.json`
- `src/`
- `.env.example`
- `tsconfig.json`
- `README.md`

Do **not** copy `node_modules/` or `dist/` — they are regenerated locally.

## 2) Install Prerequisites

- **Node.js 20+** — check with `node -v`
- **npm** — comes with Node.js

## 3) Install Dependencies

```bash
cd /path/to/lana-solana-bot
npm install
```

## 4) Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Where to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) on Telegram |
| `LANA_API_KEY` | Your Lana API invite (from Helius) |
| `LANA_BASE_URL` | Use the host from your invite (default: `https://lana-api.helius-experiments.com`) |

Optional tuning:

- `LANA_MODEL_FAST=lana-fast` — quick answers
- `LANA_MODEL_THINKING=lana-thinking` — deeper analysis
- `LANA_ENABLE_DEEP_SCAN=false` — keep off unless you need full tx history
- `LANA_MAX_TOKENS=4096` — increase for longer answers (max 8192)

## 5) Verify Lana Connectivity

Before starting the bot, confirm the Lana API is reachable:

```bash
curl https://lana-api.helius-experiments.com/health
```

Expected response:

```json
{ "status": "ok", "uptime": 12345, "timestamp": "..." }
```

Test your API key:

```bash
curl -X POST "https://lana-api.helius-experiments.com/v1/messages" \
  -H 'content-type: application/json' \
  -H "x-api-key: YOUR_LANA_KEY" \
  -d '{
    "model": "lana-fast",
    "max_tokens": 256,
    "messages": [{ "role": "user", "content": "What is the USDC mint on Solana?" }]
  }'
```

## 6) Validate Build

```bash
npm run typecheck
npm run build
```

## 7) Run

Development (with hot reload via tsx):

```bash
npm run dev
```

Production:

```bash
npm run build
npm run start
```

## 8) Telegram Bot Setup

In [@BotFather](https://t.me/BotFather):

1. Create a bot and copy the token into `.env`
2. Enable **Inline Mode** if you want `@YourBot query` in any chat
3. For group usage: add the bot to a group; disable privacy mode only if you need it to read all messages

## 9) Test Commands

In a Telegram chat with your bot:

```
/start
/lookup <solana_wallet_address>
/tx <transaction_signature>
/flow <wallet_address> 2
/chat
```

Or paste a Solana address directly for auto-lookup.

## 10) Common Issues

| Symptom | Fix |
|---|---|
| `authentication_error` (401) | Check `LANA_API_KEY` in `.env` |
| `rate_limit_error` (429) | Wait for `Retry-After` seconds; default is 100 req/hour |
| Bot not responding | Verify `TELEGRAM_BOT_TOKEN` and internet access |
| `context_overflow` | Use `/clear` to reset chat history |
| TypeScript errors after pull | Run `npm install` again, then `npm run typecheck` |
| Lana timeout | Increase `LANA_TIMEOUT_MS` (max turn is 5 minutes) |

## 11) Production Deployment (Optional)

- Use a process manager: `pm2`, `systemd`, or Docker
- Replace in-memory session/rate-limit with Redis for multi-instance setups
- Set `NODE_ENV=production`
- Never commit `.env` to version control

## 12) Export Checklist

- [ ] Copied source files (not `node_modules`)
- [ ] Created `.env` with valid tokens
- [ ] Ran `npm install`
- [ ] Lana `/health` returns `ok`
- [ ] `npm run dev` starts without errors
- [ ] `/start` works in Telegram
- [ ] `/lookup` returns a wallet profile
