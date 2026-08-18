import { config } from "../config";
import { AddressProfileResponseSchema, TxExplanationSchema } from "./schemas";
import {
  ADDRESS_PROFILE_SYSTEM,
  CHAT_SYSTEM,
  TX_EXPLANATION_SYSTEM,
  addressProfilePrompt,
  txExplanationPrompt
} from "./prompts";
import type { ChatTurn } from "../types";
import type {
  LanaErrorEnvelope,
  LanaExtensions,
  LanaHealthResponse,
  LanaMessage,
  LanaModel,
  LanaRequest,
  LanaResponse
} from "./types";

export class LanaApiError extends Error {
  constructor(
    message: string,
    readonly type: string,
    readonly status: number,
    readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "LanaApiError";
  }
}

export class LanaClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = config.LANA_BASE_URL.replace(/\/$/, "");
  }

  async healthCheck(): Promise<LanaHealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Lana health check failed: ${response.status}`);
    }
    return (await response.json()) as LanaHealthResponse;
  }

  async getAddressProfile(address: string) {
    const text = await this.sendMessage({
      model: config.LANA_MODEL_THINKING,
      max_tokens: config.LANA_MAX_TOKENS,
      system: ADDRESS_PROFILE_SYSTEM,
      messages: [{ role: "user", content: addressProfilePrompt(address) }],
      extensions: {
        enable_deep_scan: config.LANA_ENABLE_DEEP_SCAN
      }
    });

    const json = this.extractJson(text);
    return AddressProfileResponseSchema.parse(json);
  }

  async explainTransaction(signature: string) {
    const text = await this.sendMessage({
      model: config.LANA_MODEL_THINKING,
      max_tokens: config.LANA_MAX_TOKENS,
      system: TX_EXPLANATION_SYSTEM,
      messages: [{ role: "user", content: txExplanationPrompt(signature) }]
    });

    const json = this.extractJson(text);
    return TxExplanationSchema.parse(json);
  }

  async chat(question: string, history: ChatTurn[], options?: { wallet?: string }) {
    const messages = this.toLanaMessages(history, question);
    const extensions: LanaExtensions = {};
    if (options?.wallet) {
      extensions.user_context = {
        wallet: options.wallet,
        address_kind: "wallet",
        network: config.LANA_NETWORK
      };
    }

    return this.sendMessage({
      model: config.LANA_MODEL_FAST,
      max_tokens: config.LANA_MAX_TOKENS,
      system: CHAT_SYSTEM,
      messages,
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined
    });
  }

  async analyze(prompt: string, options?: { deepScan?: boolean; model?: LanaModel }) {
    return this.sendMessage({
      model: options?.model ?? config.LANA_MODEL_THINKING,
      max_tokens: config.LANA_MAX_TOKENS,
      system: CHAT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      extensions: {
        enable_deep_scan: options?.deepScan ?? false
      }
    });
  }

  private toLanaMessages(history: ChatTurn[], question: string): LanaMessage[] {
    const prior = history
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content
      }));

    return [...prior, { role: "user", content: question }];
  }

  private async sendMessage(request: LanaRequest): Promise<string> {
    const attempts = config.LANA_RETRY_ATTEMPTS + 1;
    let lastError: unknown;

    for (let i = 0; i < attempts; i += 1) {
      try {
        return await this.postMessage(request);
      } catch (error) {
        lastError = error;
        if (error instanceof LanaApiError && error.status === 429 && error.retryAfterSec) {
          await this.sleep(error.retryAfterSec * 1000);
          continue;
        }
        if (error instanceof LanaApiError && error.status >= 400 && error.status < 500) {
          throw error;
        }
        if (i < attempts - 1) {
          await this.sleep(250 * (i + 1));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async postMessage(request: LanaRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.LANA_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.LANA_API_KEY
        },
        body: JSON.stringify({ ...request, stream: false }),
        signal: controller.signal
      });

      if (!response.ok) {
        const retryAfter = response.headers.get("Retry-After");
        const body = (await response.json().catch(() => null)) as LanaErrorEnvelope | null;
        const message = body?.error?.message ?? response.statusText;
        const type = body?.error?.type ?? "api_error";
        throw new LanaApiError(
          message,
          type,
          response.status,
          retryAfter ? Number(retryAfter) : undefined
        );
      }

      const payload = (await response.json()) as LanaResponse;
      return this.extractText(payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractText(response: LanaResponse): string {
    const text = response.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("")
      .trim();

    if (!text) {
      throw new Error("Lana returned an empty response.");
    }

    return text;
  }

  private extractJson(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced?.[1]?.trim() ?? text.trim();

    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1));
      }
      throw new Error("Lana returned a response that could not be parsed as JSON.");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
