import { LanaApiError } from "./errors";
import type { LanaDocument, LanaSource, LanaTurnResult } from "./types";

interface SseFrame {
  event?: string;
  data?: Record<string, unknown>;
}

export async function readLanaSseStream(
  response: Response,
  onDelta?: (text: string) => Promise<void> | void
): Promise<LanaTurnResult> {
  if (!response.body) {
    throw new Error("Lana stream had no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const followUps: string[] = [];
  const sources: LanaSource[] = [];
  const documents: LanaDocument[] = [];
  const uiBlocks: unknown[] = [];
  let uiSchema: unknown;

  const emit = async () => {
    if (onDelta) {
      await onDelta(text);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const rawFrame of frames) {
      const frame = parseSseFrame(rawFrame);
      if (!frame.data) {
        continue;
      }
      applyFrame(frame, {
        appendText: (chunk) => {
          text += chunk;
        },
        followUps,
        sources,
        documents,
        uiBlocks,
        setUiSchema: (schema) => {
          uiSchema = schema;
        }
      });
      if (frame.event === "content_block_delta" || frame.data.delta) {
        await emit();
      }
    }
  }

  return {
    text: text.trim(),
    followUps: uniqueStrings(followUps),
    sources: sources.sort((a, b) => a.index - b.index),
    documents,
    uiSchema: uiSchema ?? (uiBlocks.length > 0 ? { components: uiBlocks } : undefined)
  };
}

function parseSseFrame(frame: string): SseFrame {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  const raw = dataLines.join("\n");
  if (!raw) {
    return { event };
  }
  try {
    return { event, data: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { event };
  }
}

function applyFrame(
  frame: SseFrame,
  acc: {
    appendText: (chunk: string) => void;
    followUps: string[];
    sources: LanaSource[];
    documents: LanaDocument[];
    uiBlocks: unknown[];
    setUiSchema: (schema: unknown) => void;
  }
): void {
  const data = frame.data;
  if (!data) {
    return;
  }

  if (data.error && typeof data.error === "object") {
    const err = data.error as { type?: string; message?: string };
    throw new LanaApiError(err.message ?? "Lana stream error", err.type ?? "api_error", 200);
  }

  const delta = data.delta as { type?: string; text?: string } | undefined;
  if (delta?.type === "text_delta" && delta.text) {
    acc.appendText(delta.text);
  }

  const suggestions = data.suggestions;
  if (Array.isArray(suggestions)) {
    for (const item of suggestions) {
      if (typeof item === "string" && item.trim()) {
        acc.followUps.push(item.trim());
      }
    }
  }

  if (typeof data.url === "string" && typeof data.index === "number") {
    acc.sources.push({
      index: data.index,
      url: data.url,
      title: typeof data.title === "string" ? data.title : data.url,
      snippet: typeof data.snippet === "string" ? data.snippet : ""
    });
  }

  if (typeof data.filename === "string" && typeof data.content === "string") {
    acc.documents.push({
      tool_use_id: typeof data.tool_use_id === "string" ? data.tool_use_id : undefined,
      filename: data.filename,
      format: typeof data.format === "string" ? data.format : "txt",
      content: data.content,
      description: typeof data.description === "string" ? data.description : undefined
    });
  }

  if (frame.event === "ui_schema" && data.schema !== undefined) {
    acc.setUiSchema(data.schema);
  } else if (frame.event === "ui_block") {
    acc.uiBlocks.push(data);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].slice(0, 4);
}

export function turnResultFromMessage(payload: {
  content?: Array<{ type: string; text?: string }>;
  follow_up?: string[];
  sources?: LanaSource[];
  documents?: LanaDocument[];
  ui_schema?: unknown;
}): LanaTurnResult {
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("")
    .trim();

  return {
    text,
    followUps: uniqueStrings(payload.follow_up ?? []),
    sources: payload.sources ?? [],
    documents: payload.documents ?? [],
    uiSchema: payload.ui_schema
  };
}
