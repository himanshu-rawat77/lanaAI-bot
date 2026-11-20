export type ChatRole = "user" | "assistant" | "system";

export interface ChatTurn {
  role: ChatRole;
  content: string;
  timestamp: number;
}

export interface PendingConfirmation {
  type: "send" | "withdraw";
  amountSol: number;
  recipientAddress: string;
  recipientDisplay: string;
  timestamp: number;
}

export interface BotSession {
  chatMode: boolean;
  chatHistory: ChatTurn[];
  connectedWallet?: string;
  timeZone?: string;
  pendingFollowUps: string[];
  pendingConfirmation?: PendingConfirmation;
  awaitingRegistrationInput?: boolean;
  awaitingImportKey?: boolean;
}

export interface AddressProfile {
  address: string;
  riskScore: number;
  reputation: "low" | "medium" | "high" | "unknown";
  narrative: string;
  labels: string[];
  topCounterparties: string[];
  firstActivityDate: string;
}
