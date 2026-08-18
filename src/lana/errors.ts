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
