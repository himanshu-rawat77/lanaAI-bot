import { LanaApiError } from "../lana/client";

export function formatLanaError(error: unknown): string {
  if (error instanceof LanaApiError) {
    switch (error.type) {
      case "authentication_error":
        return "Lana API authentication failed. Please check your API key.";
      case "rate_limit_error":
        return error.retryAfterSec
          ? `Lana rate limit reached. Please try again in ${error.retryAfterSec}s.`
          : "Lana rate limit reached. Please try again shortly.";
      case "context_overflow":
        return "Conversation is too long. Use /clear and try again.";
      case "invalid_request_error":
        return `Invalid request: ${error.message}`;
      default:
        return `Lana error: ${error.message}`;
    }
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Lana request timed out. Please try again.";
    }
    return error.message;
  }

  return "Something went wrong while contacting Lana.";
}
