// ===========================================================================
// Real-time contract shared (conceptually) by the API server and clients.
// Keep this file framework-free so it can be copied to the Next.js frontend.
// ===========================================================================

export const SOCKET_EVENTS = {
  // client -> server
  HOST_JOIN: "host:join",
  HOST_START: "host:start",
  HOST_NEXT: "host:next",
  HOST_SKIP: "host:skip",
  PLAYER_JOIN: "player:join",
  PLAYER_ANSWER: "player:answer",

  // server -> client
  STATE: "game:state",
  LOBBY_UPDATE: "lobby:update",
  QUESTION: "game:question",
  TIMER: "game:timer",
  REVEAL: "game:reveal",
  GAME_OVER: "game:over",
  ERROR: "game:error",
} as const;

// ---- shared value objects -------------------------------------------------

export interface PublicOption {
  id: string;
  order: number;
  text: string;
}

export interface PublicQuestion {
  id: string;
  index: number; // 0-based position in the quiz
  total: number; // total number of questions
  text: string;
  options: PublicOption[];
  multiple: boolean; // true = more than one correct answer; player picks a set
  correctCount: number; // how many options are correct (drives the "Choose N" hint)
  timeLimit: number; // seconds
  points: number;
  startedAt: number; // epoch ms when the question opened (authoritative)
}

export interface LeaderboardRow {
  participantId: string;
  nickname: string;
  score: number;
  rank: number;
  lastGain?: number; // points earned on the most recent question
}

export interface ParticipantInfo {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
}

// ---- client -> server payloads -------------------------------------------

export interface HostJoinPayload {
  sessionId: string;
}
export interface PlayerJoinPayload {
  joinCode: string;
  nickname: string;
  participantId?: string; // present when reconnecting
}
export interface PlayerAnswerPayload {
  questionId: string;
  optionIds: string[]; // one id for single-answer, the full chosen set for multi-answer
}

// ---- server -> client payloads -------------------------------------------

export type GamePhase = "lobby" | "question" | "reveal" | "over";

export interface StatePayload {
  phase: GamePhase;
  sessionId: string;
  joinCode: string;
  quizTitle: string;
  participants: ParticipantInfo[];
  // present depending on phase:
  question?: PublicQuestion;
  leaderboard?: LeaderboardRow[];
  // for a reconnecting player:
  you?: ParticipantInfo;
  yourAnswerOptionIds?: string[] | null;
}

export interface LobbyUpdatePayload {
  participants: ParticipantInfo[];
  count: number;
}

export interface TimerPayload {
  questionId: string;
  remainingMs: number;
}

export interface OptionTally {
  optionId: string;
  order: number;
  count: number;
  isCorrect: boolean;
}

export interface RevealPayload {
  questionId: string;
  correctOptionIds: string[];
  tally: OptionTally[];
  leaderboard: LeaderboardRow[];
  // personalized (only sent to the owning player):
  yourResult?: {
    correct: boolean;
    pointsAwarded: number;
    totalScore: number;
  };
  answeredCount: number;
  totalPlayers: number;
}

export interface QuestionStats {
  questionId: string;
  text: string;
  correctCount: number;
  totalAnswers: number;
  accuracy: number; // 0..1
  averageTimeMs: number;
  tally: OptionTally[];
}

export interface GameOverPayload {
  leaderboard: LeaderboardRow[];
  stats: {
    totalPlayers: number;
    totalQuestions: number;
    questionStats: QuestionStats[];
  };
}
