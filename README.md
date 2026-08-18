# Lana Solana Bot

Production-focused Telegram bot powered by the [Lana API](https://orbmarkets.io/lana-api/docs) for Solana on-chain intelligence.

## Features

- `/start` onboarding with examples
- `/lookup <address>` Truecaller-style wallet profile (star feature)
- `/tx <signature>` transaction explanation
- `/flow <address> [depth]` fund flow summary
- `/chat` free-form Lana chat (streaming, follow-up buttons, citations)
- `/connect <wallet>` saves `user_context` for “my portfolio” questions
- UI-schema rendered as HTML cards; CSV/JSON/TXT sent as files
- Inline mode support for any Telegram chat
- In-memory rate limiting and session memory

## Stack

- Node.js + TypeScript
- [grammY](https://grammy.dev)
- Lana API (`POST /v1/messages`, Anthropic-style)
- Zod config and response validation
- dotenv configuration

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy envs:

```bash
cp .env.example .env
```

3. Fill required values in `.env`:
   - `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather)
   - `LANA_API_KEY` from your Lana invite

4. Run in development:

```bash
npm run dev
```

## Lana API Configuration

| Variable | Default | Description |
|---|---|---|
| `LANA_BASE_URL` | `https://lana-api.helius-experiments.com` | Lana API host |
| `LANA_MODEL_FAST` | `lana-fast` | Quick lookups and chat |
| `LANA_MODEL_THINKING` | `lana-thinking` | Multi-step analysis (address profiles, tx) |
| `LANA_MAX_TOKENS` | `4096` | Max output tokens per request |
| `LANA_ENABLE_DEEP_SCAN` | `false` | Full archival history scans (expensive) |
| `LANA_STREAM` | `true` | Stream answers and edit the Telegram message live |
| `LANA_TIMEZONE` | `UTC` | IANA timezone sent as `user_context.time_zone` |

Set `LANA_ENABLE_DEEP_SCAN=true` only when you need full-history analysis (up to 10k txs per scan).

## Build and Run

```bash
npm run build
npm run start
```

## Run On Another Device

See `RUN_ON_ANOTHER_DEVICE.md` for a full migration checklist.

## Project Structure

```text
src/
  bot.ts
  index.ts
  config.ts
  handlers/
    commands.ts
    messages.ts
    inline.ts
  lana/
    client.ts
    prompts.ts
    schemas.ts
    types.ts
  services/
    address-profile.ts
  utils/
    format.ts
    lana-errors.ts
    rate-limit.ts
    session.ts
    solana.ts
```
