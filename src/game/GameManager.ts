import type { Server, Socket } from "socket.io";
import { prisma } from "../prisma.js";
import {
  SOCKET_EVENTS as EV,
  type GamePhase,
  type LeaderboardRow,
  type ParticipantInfo,
  type PublicQuestion,
  type RevealPayload,
  type StatePayload,
  type GameOverPayload,
  type OptionTally,
  type QuestionStats,
} from "../shared/events.js";

// ---- internal in-memory shapes -------------------------------------------

interface LoadedOption {
  id: string;
  order: number;
  text: string;
  isCorrect: boolean;
}

interface LoadedQuestion {
  id: string;
  order: number;
  text: string;
  timeLimit: number;
  points: number;
  options: LoadedOption[];
  multiple: boolean; // more than one correct option
  correctCount: number;
}

interface RoomParticipant {
  id: string;
  nickname: string;
  score: number; // number of correct answers (the points system was removed)
  wrongCount: number; // number of incorrect answers
  connected: boolean;
  socketId: string | null;
}

interface CurrentAnswer {
  optionIds: string[]; // every option the player selected
  timeTakenMs: number;
  correct: boolean;
}

interface GameRoom {
  sessionId: string;
  joinCode: string;
  quizTitle: string;
  questions: LoadedQuestion[];
  participants: Map<string, RoomParticipant>;
  phase: GamePhase;
  currentIndex: number;
  questionStartedAt: number; // epoch ms
  answers: Map<string, CurrentAnswer>; // for the current question, by participantId
  timer: NodeJS.Timeout | null;
  history: Array<Map<string, CurrentAnswer>>; // answers per finished question (by index)
}

const ANSWER_GRACE_MS = 750; // tolerance for network latency past the time limit

export class GameManager {
  private rooms = new Map<string, GameRoom>();

  constructor(private io: Server) {}

  // ---- room lifecycle -----------------------------------------------------

  private roomChannel(sessionId: string) {
    return `session:${sessionId}`;
  }

  /** Load a session + quiz questions from the DB into memory (idempotent). */
  private async ensureRoom(sessionId: string): Promise<GameRoom> {
    const existing = this.rooms.get(sessionId);
    if (existing) return existing;

    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: {
        quiz: {
          include: {
            questions: {
              orderBy: { order: "asc" },
              include: { options: { orderBy: { order: "asc" } } },
            },
          },
        },
        participants: true,
      },
    });
    if (!session) throw new Error("Session not found");

    const room: GameRoom = {
      sessionId: session.id,
      joinCode: session.joinCode,
      quizTitle: session.quiz.title,
      questions: session.quiz.questions.map((q) => {
        const correctCount = q.options.filter((o) => o.isCorrect).length;
        return {
          id: q.id,
          order: q.order,
          text: q.text,
          timeLimit: q.timeLimit,
          points: q.points,
          options: q.options.map((o) => ({
            id: o.id,
            order: o.order,
            text: o.text,
            isCorrect: o.isCorrect,
          })),
          multiple: q.type === "MULTIPLE" || correctCount > 1,
          correctCount,
        };
      }),
      participants: new Map(
        session.participants.map((p) => [
          p.id,
          {
            id: p.id,
            nickname: p.nickname,
            score: p.score,
            wrongCount: 0,
            connected: false,
            socketId: null,
          },
        ])
      ),
      phase: session.status === "FINISHED" ? "over" : "lobby",
      currentIndex: session.currentIndex,
      questionStartedAt: 0,
      answers: new Map(),
      timer: null,
      history: [],
    };
    this.rooms.set(sessionId, room);
    return room;
  }

  // ---- host actions -------------------------------------------------------

  async hostJoin(socket: Socket, sessionId: string) {
    const room = await this.ensureRoom(sessionId);
    socket.join(this.roomChannel(sessionId));
    socket.join(`${this.roomChannel(sessionId)}:host`);
    socket.data.role = "host";
    socket.data.sessionId = sessionId;
    socket.emit(EV.STATE, this.buildState(room));
  }

  async start(sessionId: string) {
    const room = await this.ensureRoom(sessionId);
    if (room.questions.length === 0) {
      this.io
        .to(this.roomChannel(sessionId))
        .emit(EV.ERROR, { message: "This quiz has no questions." });
      return;
    }
    if (room.phase !== "lobby") return;
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    await this.showQuestion(room, 0);
  }

  async next(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    if (room.phase === "question") {
      // host advancing while a question is live = reveal it first
      await this.reveal(room);
      return;
    }
    const nextIndex = room.currentIndex + 1;
    if (nextIndex >= room.questions.length) {
      await this.gameOver(room);
    } else {
      await this.showQuestion(room, nextIndex);
    }
  }

  async skip(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (room && room.phase === "question") await this.reveal(room);
  }

  // ---- question flow ------------------------------------------------------

  private async showQuestion(room: GameRoom, index: number) {
    if (room.timer) clearTimeout(room.timer);
    const q = room.questions[index];
    room.phase = "question";
    room.currentIndex = index;
    room.questionStartedAt = Date.now();
    room.answers = new Map();

    await prisma.gameSession.update({
      where: { id: room.sessionId },
      data: { currentIndex: index },
    });

    const payload: PublicQuestion = {
      id: q.id,
      index,
      total: room.questions.length,
      text: q.text,
      options: q.options.map((o) => ({ id: o.id, order: o.order, text: o.text })),
      multiple: q.multiple,
      correctCount: q.correctCount,
      timeLimit: q.timeLimit,
      points: q.points,
      startedAt: room.questionStartedAt,
    };
    this.io.to(this.roomChannel(room.sessionId)).emit(EV.QUESTION, payload);

    room.timer = setTimeout(() => {
      void this.reveal(room);
    }, q.timeLimit * 1000 + ANSWER_GRACE_MS);
  }

  async submitAnswer(
    socket: Socket,
    participantId: string,
    questionId: string,
    optionIds: string[]
  ) {
    const sessionId = socket.data.sessionId as string | undefined;
    if (!sessionId) return;
    const room = this.rooms.get(sessionId);
    if (!room || room.phase !== "question") return;

    const q = room.questions[room.currentIndex];
    if (!q || q.id !== questionId) return; // stale answer for a previous question
    if (room.answers.has(participantId)) return; // already answered

    const elapsed = Date.now() - room.questionStartedAt;
    if (elapsed > q.timeLimit * 1000 + ANSWER_GRACE_MS) return; // too late

    // keep only valid, de-duplicated option ids that belong to this question
    const validIds = new Set(q.options.map((o) => o.id));
    const selected = [...new Set(optionIds)].filter((id) => validIds.has(id));
    if (selected.length === 0) return; // empty submission is ignored

    // All-or-nothing: the chosen set must be exactly the set of correct options.
    const correctIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
    const correct =
      selected.length === correctIds.length &&
      selected.every((id) => correctIds.includes(id));

    room.answers.set(participantId, { optionIds: selected, timeTakenMs: elapsed, correct });

    const participant = room.participants.get(participantId);
    if (participant) {
      // scoring is now a simple right/wrong tally — no time-weighted points
      if (correct) participant.score += 1;
      else participant.wrongCount += 1;
    }

    // ack to the answering player only (no leak of correctness yet beyond their own)
    socket.emit("game:answer-ack", {
      questionId,
      received: true,
      answeredCount: room.answers.size,
    });

    // let the host see live progress
    this.io.to(`${this.roomChannel(room.sessionId)}:host`).emit("game:answer-progress", {
      answeredCount: room.answers.size,
      totalPlayers: this.connectedCount(room),
    });

    // everyone answered -> reveal early
    if (room.answers.size >= this.connectedCount(room) && this.connectedCount(room) > 0) {
      await this.reveal(room);
    }
  }

  private async reveal(room: GameRoom) {
    if (room.phase !== "question") return;
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    room.phase = "reveal";
    const q = room.questions[room.currentIndex];

    // build tally — correctness stays hidden until the game ends, so we report
    // isCorrect:false here even though the DB still records the true result.
    const tally: OptionTally[] = q.options.map((o) => ({
      optionId: o.id,
      order: o.order,
      count: 0,
      isCorrect: false,
    }));
    const tallyByOption = new Map(tally.map((t) => [t.optionId, t]));
    for (const ans of room.answers.values()) {
      for (const optionId of ans.optionIds) {
        const t = tallyByOption.get(optionId);
        if (t) t.count++;
      }
    }

    // persist answers + updated scores for this question
    await this.persistQuestion(room, q.id);

    // snapshot history for end-of-game stats
    room.history[room.currentIndex] = new Map(room.answers);

    const leaderboard = this.buildLeaderboard(room);

    // Everyone gets the same neutral reveal: vote counts + standings, but no
    // correct answers and no per-player result. Those are saved for the end.
    const payload: RevealPayload = {
      questionId: q.id,
      correctOptionIds: [],
      tally,
      leaderboard,
      answeredCount: room.answers.size,
      totalPlayers: this.connectedCount(room),
    };
    this.io.to(this.roomChannel(room.sessionId)).emit(EV.REVEAL, payload);
  }

  private async gameOver(room: GameRoom) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    room.phase = "over";
    await prisma.gameSession.update({
      where: { id: room.sessionId },
      data: { status: "FINISHED", endedAt: new Date() },
    });

    const leaderboard = this.buildLeaderboard(room);
    const questionStats: QuestionStats[] = room.questions.map((q, i) => {
      const ans = room.history[i] ?? new Map<string, CurrentAnswer>();
      const tally: OptionTally[] = q.options.map((o) => ({
        optionId: o.id,
        order: o.order,
        count: 0,
        isCorrect: o.isCorrect,
      }));
      const byOpt = new Map(tally.map((t) => [t.optionId, t]));
      let correctCount = 0;
      let totalTime = 0;
      for (const a of ans.values()) {
        for (const optionId of a.optionIds) {
          const t = byOpt.get(optionId);
          if (t) t.count++;
        }
        if (a.correct) correctCount++;
        totalTime += a.timeTakenMs;
      }
      const totalAnswers = ans.size;
      return {
        questionId: q.id,
        text: q.text,
        correctCount,
        totalAnswers,
        accuracy: totalAnswers ? correctCount / totalAnswers : 0,
        averageTimeMs: totalAnswers ? Math.round(totalTime / totalAnswers) : 0,
        tally,
      };
    });

    const payload: GameOverPayload = {
      leaderboard,
      stats: {
        totalPlayers: room.participants.size,
        totalQuestions: room.questions.length,
        questionStats,
      },
    };
    this.io.to(this.roomChannel(room.sessionId)).emit(EV.GAME_OVER, payload);
  }

  // ---- player actions -----------------------------------------------------

  async playerJoin(
    socket: Socket,
    joinCode: string,
    nickname: string,
    participantId?: string
  ): Promise<{ ok: boolean; error?: string; participant?: ParticipantInfo }> {
    const session = await prisma.gameSession.findUnique({
      where: { joinCode: joinCode.toUpperCase() },
    });
    if (!session) return { ok: false, error: "Game not found." };
    if (session.status === "FINISHED") return { ok: false, error: "This game has ended." };

    const room = await this.ensureRoom(session.id);
    const cleanName = nickname.trim().slice(0, 24);
    if (!cleanName) return { ok: false, error: "Please enter a nickname." };

    let participant: RoomParticipant | undefined;

    // reconnect by id
    if (participantId && room.participants.has(participantId)) {
      participant = room.participants.get(participantId)!;
    } else {
      // joining mid-game is only allowed in the lobby
      if (room.phase !== "lobby") {
        return { ok: false, error: "Game already started." };
      }
      const taken = [...room.participants.values()].some(
        (p) => p.nickname.toLowerCase() === cleanName.toLowerCase()
      );
      if (taken) return { ok: false, error: "Nickname already taken." };

      const created = await prisma.participant.create({
        data: { sessionId: session.id, nickname: cleanName },
      });
      participant = {
        id: created.id,
        nickname: created.nickname,
        score: 0,
        wrongCount: 0,
        connected: true,
        socketId: null,
      };
      room.participants.set(participant.id, participant);
    }

    participant.connected = true;
    participant.socketId = socket.id;
    await prisma.participant.update({
      where: { id: participant.id },
      data: { connected: true },
    });

    socket.join(this.roomChannel(session.id));
    socket.data.role = "player";
    socket.data.sessionId = session.id;
    socket.data.participantId = participant.id;

    // send current state so a late/reconnecting player lands in the right screen
    socket.emit(EV.STATE, this.buildState(room, participant.id));

    // notify host + lobby of the roster change
    this.broadcastLobby(room);

    return { ok: true, participant: this.toInfo(participant) };
  }

  async handleDisconnect(socket: Socket) {
    const sessionId = socket.data.sessionId as string | undefined;
    const participantId = socket.data.participantId as string | undefined;
    if (!sessionId) return;
    const room = this.rooms.get(sessionId);
    if (!room) return;

    if (participantId) {
      const p = room.participants.get(participantId);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        p.socketId = null;
        await prisma.participant
          .update({ where: { id: participantId }, data: { connected: false } })
          .catch(() => {});
        this.broadcastLobby(room);
      }
    }
  }

  // ---- helpers ------------------------------------------------------------

  private connectedCount(room: GameRoom): number {
    let n = 0;
    for (const p of room.participants.values()) if (p.connected) n++;
    return n;
  }

  private toInfo(p: RoomParticipant): ParticipantInfo {
    return { id: p.id, nickname: p.nickname, score: p.score, connected: p.connected };
  }

  private buildLeaderboard(room: GameRoom): LeaderboardRow[] {
    const rows = [...room.participants.values()]
      // most correct first; fewer wrong breaks ties
      .sort((a, b) => b.score - a.score || a.wrongCount - b.wrongCount)
      .map((p, i) => ({
        participantId: p.id,
        nickname: p.nickname,
        correctCount: p.score, // p.score now tracks the number of correct answers
        wrongCount: p.wrongCount,
        rank: i + 1,
      }));
    return rows;
  }

  private broadcastLobby(room: GameRoom) {
    const participants = [...room.participants.values()].map((p) => this.toInfo(p));
    this.io.to(this.roomChannel(room.sessionId)).emit(EV.LOBBY_UPDATE, {
      participants,
      count: participants.length,
    });
  }

  private buildState(room: GameRoom, participantId?: string): StatePayload {
    const participants = [...room.participants.values()].map((p) => this.toInfo(p));
    const state: StatePayload = {
      phase: room.phase,
      sessionId: room.sessionId,
      joinCode: room.joinCode,
      quizTitle: room.quizTitle,
      participants,
    };

    if (room.phase === "question" || room.phase === "reveal") {
      const q = room.questions[room.currentIndex];
      if (q) {
        state.question = {
          id: q.id,
          index: room.currentIndex,
          total: room.questions.length,
          text: q.text,
          options: q.options.map((o) => ({ id: o.id, order: o.order, text: o.text })),
          multiple: q.multiple,
          correctCount: q.correctCount,
          timeLimit: q.timeLimit,
          points: q.points,
          startedAt: room.questionStartedAt,
        };
      }
      state.leaderboard = this.buildLeaderboard(room);
    }
    if (room.phase === "over") {
      state.leaderboard = this.buildLeaderboard(room);
    }

    if (participantId) {
      const p = room.participants.get(participantId);
      if (p) {
        state.you = this.toInfo(p);
        state.yourAnswerOptionIds = room.answers.get(participantId)?.optionIds ?? null;
      }
    }
    return state;
  }

  /** Persist this question's answers and the resulting participant scores. */
  private async persistQuestion(room: GameRoom, questionId: string) {
    const rows = [...room.answers.entries()].map(([participantId, a]) => ({
      sessionId: room.sessionId,
      participantId,
      questionId,
      // keep the legacy single-option column populated only for single answers
      optionId: a.optionIds.length === 1 ? a.optionIds[0] : null,
      selectedOptionIds: a.optionIds,
      isCorrect: a.correct,
      timeTakenMs: a.timeTakenMs,
      // points were removed; record 1 for a correct answer, 0 otherwise
      pointsAwarded: a.correct ? 1 : 0,
    }));
    if (rows.length) {
      await prisma.answer
        .createMany({ data: rows, skipDuplicates: true })
        .catch((e) => console.error("persist answers failed", e));
    }
    // update scores in DB (best-effort; memory is authoritative during play)
    await Promise.all(
      [...room.participants.values()].map((p) =>
        prisma.participant
          .update({ where: { id: p.id }, data: { score: p.score } })
          .catch(() => {})
      )
    );
  }
}
