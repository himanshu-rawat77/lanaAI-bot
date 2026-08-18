import { createBot } from "./bot";
import { LanaClient } from "./lana/client";

async function main(): Promise<void> {
  const lana = new LanaClient();
  try {
    const health = await lana.healthCheck();
    console.log(`Lana API healthy (uptime: ${Math.round(health.uptime)}s)`);
  } catch (err) {
    console.warn("Lana health check failed — bot will still start:", err);
  }

  const bot = createBot();
  console.log("Starting Lana Solana Bot...");
  await bot.start();
}

main().catch((err) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
