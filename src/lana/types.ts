export type LanaModel = "lana-fast" | "lana-thinking";

export interface LanaMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LanaUserContext {
  wallet?: string;
  time_zone?: string;
  address_kind?: "wallet" | "token";
  network?: "mainnet" | "devnet";
}

export interface LanaExtensions {
  include_ui_schema?: boolean;
  include_followups?: boolean;
  include_documents?: boolean;
  enable_deep_scan?: boolean;
  user_context?: LanaUserContext;
}

export interface LanaRequest {
  model: LanaModel;
  max_tokens: number;
  messages: LanaMessage[];
  system?: string;
  stream?: boolean;
  extensions?: LanaExtensions;
}

export interface LanaContentBlock {
  type: string;
  text?: string;
}

export interface LanaUsage {
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
  prompt_tokens: number;
  context_window: number;
}

export interface LanaSource {
  index: number;
  url: string;
  title: string;
  snippet: string;
}

export interface LanaDocument {
  tool_use_id?: string;
  filename: string;
  format: string;
  content: string;
  description?: string;
}

export interface LanaResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: LanaContentBlock[];
  stop_reason: string;
  usage?: LanaUsage;
  follow_up?: string[];
  sources?: LanaSource[];
  documents?: LanaDocument[];
  ui_schema?: unknown;
}

export interface LanaTurnResult {
  text: string;
  followUps: string[];
  sources: LanaSource[];
  documents: LanaDocument[];
  uiSchema?: unknown;
}

export interface LanaErrorEnvelope {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

export interface LanaHealthResponse {
  status: string;
  uptime: number;
  timestamp: string;
}

export interface ChatCallOptions {
  wallet?: string;
  timeZone?: string;
  deepScan?: boolean;
  stream?: boolean;
  onDelta?: (text: string) => Promise<void> | void;
}
