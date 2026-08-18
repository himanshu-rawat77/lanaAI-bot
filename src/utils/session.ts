import type { BotSession, ChatTurn, ChatRole } from "../types";

export const initialSession = (): BotSession => ({
  chatMode: true,
  chatHistory: [],
  pendingFollowUps: []
});

export function pushChatTurn(
  session: BotSession,
  role: ChatRole,
  content: string,
  maxHistory: number
): void {
  if (role === "system") {
    return;
  }

  const turn: ChatTurn = {
    role,
    content,
    timestamp: Date.now()
  };
  session.chatHistory.push(turn);
  if (session.chatHistory.length > maxHistory) {
    session.chatHistory = session.chatHistory.slice(-maxHistory);
  }
}
