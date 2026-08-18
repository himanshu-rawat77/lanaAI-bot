import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  LANA_API_KEY: z.string().min(1, "LANA_API_KEY is required"),
  LANA_BASE_URL: z.string().url().default("https://lana-api.helius-experiments.com"),
  LANA_MODEL_FAST: z.enum(["lana-fast", "lana-thinking"]).default("lana-fast"),
  LANA_MODEL_THINKING: z.enum(["lana-fast", "lana-thinking"]).default("lana-thinking"),
  LANA_MAX_TOKENS: z.coerce.number().int().min(1).max(8192).default(4096),
  LANA_ENABLE_DEEP_SCAN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LANA_NETWORK: z.enum(["mainnet", "devnet"]).default("mainnet"),
  LANA_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  LANA_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  SESSION_HISTORY_LIMIT: z.coerce.number().int().min(3).max(20).default(8),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20)
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const config: AppConfig = ConfigSchema.parse(process.env);
