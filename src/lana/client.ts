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
import { LanaApiError } from "./errors";
import { readLanaSseStream, turnResultFromMessage } from "./stream";
import type {
  ChatCallOptions,
  LanaErrorEnvelope,
  LanaExtensions,
  LanaHealthResponse,
  LanaMessage,
  LanaModel,
  LanaRequest,
  LanaResponse,
  LanaTurnResult
} from "./types";

export { LanaApiError } from "./errors";

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
    const result = await this.complete({
      model: config.LANA_MODEL_THINKING,
      max_tokens: config.LANA_MAX_TOKENS,
      system: ADDRESS_PROFILE_SYSTEM,
      messages: [{ role: "user", content: addressProfilePrompt(address) }],
      extensions: {
        enable_deep_scan: config.LANA_ENABLE_DEEP_SCAN
      }
    });

    const json = this.extractJson(result.text);
    return AddressProfileResponseSchema.parse(json);
  }

  async explainTransaction(signature: string) {
    const result = await this.complete({
      model: config.LANA_MODEL_THINKING,
      max_tokens: config.LANA_MAX_TOKENS,
      system: TX_EXPLANATION_SYSTEM,
      messages: [{ role: "user", content: txExplanationPrompt(signature) }]
    });

    const json = this.extractJson(result.text);
    return TxExplanationSchema.parse(json);
  }

  async chat(
    question: string,
    history: ChatTurn[],
    options: ChatCallOptions = {}
  ): Promise<LanaTurnResult> {
    const messages = this.toLanaMessages(history, question);
    return this.complete(
      {
        model: config.LANA_MODEL_THINKING,
        max_tokens: config.LANA_MAX_TOKENS,
        system: CHAT_SYSTEM,
        messages,
        extensions: this.chatExtensions(options)
      },
      {
        stream: options.stream ?? config.LANA_STREAM,
        onDelta: options.onDelta
      }
    );
  }

  async analyze(prompt: string, options?: { deepScan?: boolean; model?: LanaModel }) {
    const result = await this.complete({
      model: options?.model ?? config.LANA_MODEL_THINKING,
      max_tokens: config.LANA_MAX_TOKENS,
      system: CHAT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      extensions: {
        enable_deep_scan: options?.deepScan ?? false
      }
    });
    return result.text;
  }

  private chatExtensions(options: ChatCallOptions): LanaExtensions {
    const userContext: LanaExtensions["user_context"] = {
      time_zone: options.timeZone ?? config.LANA_TIMEZONE,
      network: config.LANA_NETWORK
    };
    if (options.wallet) {
      userContext.wallet = options.wallet;
      userContext.address_kind = "wallet";
    }

    return {
      include_ui_schema: true,
      include_followups: true,
      include_documents: true,
      enable_deep_scan: options.deepScan ?? false,
      user_context: userContext
    };
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

  private async complete(
    request: LanaRequest,
    runtime?: { stream?: boolean; onDelta?: (text: string) => Promise<void> | void }
  ): Promise<LanaTurnResult> {
    const attempts = config.LANA_RETRY_ATTEMPTS + 1;
    let lastError: unknown;
    const stream = runtime?.stream ?? false;

    for (let i = 0; i < attempts; i += 1) {
      try {
        return stream
          ? await this.postStream(request, runtime?.onDelta)
          : await this.postJson(request);
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

  private async postJson(request: LanaRequest): Promise<LanaTurnResult> {
    const response = await this.fetchLana({ ...request, stream: false });
    const payload = (await response.json()) as LanaResponse;
    const result = turnResultFromMessage(payload);
    if (!result.text && !result.uiSchema && result.documents.length === 0) {
      throw new Error("Lana returned an empty response.");
    }
    return result;
  }

  private async postStream(
    request: LanaRequest,
    onDelta?: (text: string) => Promise<void> | void
  ): Promise<LanaTurnResult> {
    const response = await this.fetchLana({ ...request, stream: true });
    const result = await readLanaSseStream(response, onDelta);
    if (!result.text && !result.uiSchema && result.documents.length === 0) {
      throw new Error("Lana returned an empty response.");
    }
    return result;
  }

  private async fetchLana(request: LanaRequest): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.LANA_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.LANA_API_KEY
        },
        body: JSON.stringify(request),
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

      return response;
    } finally {
      clearTimeout(timeout);
    }
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
