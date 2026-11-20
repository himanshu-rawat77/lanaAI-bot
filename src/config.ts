import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  LANA_API_KEY: z.string().min(1, "LANA_API_KEY is required"),
  LANA_BASE_URL: z.string().url().default("https://beta.helius-rpc.com/v1/lana/messages"),
  LANA_MODEL_FAST: z.enum(["lana-fast", "lana-thinking"]).default("lana-fast"),
  LANA_MODEL_THINKING: z.enum(["lana-fast", "lana-thinking"]).default("lana-thinking"),
  LANA_MAX_TOKENS: z.coerce.number().int().min(1).max(8192).default(4096),
  LANA_ENABLE_DEEP_SCAN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LANA_NETWORK: z.enum(["mainnet", "devnet"]).default("mainnet"),
  LANA_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  LANA_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  LANA_STREAM: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LANA_TIMEZONE: z.string().min(1).max(64).default("UTC"),
  SESSION_HISTORY_LIMIT: z.coerce.number().int().min(3).max(20).default(8),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),

  // Helius & Solana Privacy Rings configuration
  HELIUS_API_KEY: z.string().default(""),
  HELIUS_RPC_URL: z.string().optional(),
  WALLET_ENCRYPTION_KEY: z.string().default("lana-privacy-ring-default-encryption-secret-key-32b"),
  DATA_DIR: z.string().default("./data")
});

const parsed = ConfigSchema.parse(process.env);

export type AppConfig = z.infer<typeof ConfigSchema> & {
  getRpcUrl: () => string;
  hasValidHeliusKey: () => boolean;
};

export const config: AppConfig = {
  ...parsed,
  hasValidHeliusKey(): boolean {
    const key = parsed.HELIUS_API_KEY?.trim();
    return Boolean(key && key !== "" && !key.includes("your_helius_api_key"));
  },
  getRpcUrl(): string {
    const rawUrl = parsed.HELIUS_RPC_URL?.trim();
    if (
      rawUrl &&
      rawUrl !== "" &&
      !rawUrl.includes("your_helius_api_key") &&
      !rawUrl.includes("<API_KEY>")
    ) {
      return rawUrl;
    }
    const network = parsed.LANA_NETWORK === "devnet" ? "devnet" : "mainnet";
    if (this.hasValidHeliusKey()) {
      return `https://${network}.helius-rpc.com/?api-key=${parsed.HELIUS_API_KEY.trim()}`;
    }
    return network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  }
};
