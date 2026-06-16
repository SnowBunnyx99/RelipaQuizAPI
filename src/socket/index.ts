import type { Server, Socket } from "socket.io";
import { GameManager } from "../game/GameManager.js";
import {
  SOCKET_EVENTS as EV,
  type HostJoinPayload,
  type PlayerJoinPayload,
  type PlayerAnswerPayload,
} from "../shared/events.js";

export function registerSocketHandlers(io: Server): GameManager {
  const games = new GameManager(io);

  io.on("connection", (socket: Socket) => {
    // --- host ---
    socket.on(EV.HOST_JOIN, async (payload: HostJoinPayload, ack?: Function) => {
      try {
        await games.hostJoin(socket, payload.sessionId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
        socket.emit(EV.ERROR, { message: (err as Error).message });
      }
    });

    socket.on(EV.HOST_START, async () => {
      const sessionId = socket.data.sessionId as string | undefined;
      if (sessionId && socket.data.role === "host") await games.start(sessionId);
    });

    socket.on(EV.HOST_NEXT, async () => {
      const sessionId = socket.data.sessionId as string | undefined;
      if (sessionId && socket.data.role === "host") await games.next(sessionId);
    });

    socket.on(EV.HOST_SKIP, async () => {
      const sessionId = socket.data.sessionId as string | undefined;
      if (sessionId && socket.data.role === "host") await games.skip(sessionId);
    });

    // --- player ---
    socket.on(EV.PLAYER_JOIN, async (payload: PlayerJoinPayload, ack?: Function) => {
      const res = await games.playerJoin(
        socket,
        payload.joinCode,
        payload.nickname,
        payload.participantId
      );
      ack?.(res);
    });

    socket.on(EV.PLAYER_ANSWER, async (payload: PlayerAnswerPayload) => {
      const participantId = socket.data.participantId as string | undefined;
      if (!participantId) return;
      // accept the new optionIds[] shape; tolerate an older single optionId client
      const legacy = payload as unknown as { optionId?: string };
      const optionIds = Array.isArray(payload.optionIds)
        ? payload.optionIds
        : legacy.optionId
          ? [legacy.optionId]
          : [];
      await games.submitAnswer(socket, participantId, payload.questionId, optionIds);
    });

    socket.on("disconnect", () => {
      void games.handleDisconnect(socket);
    });
  });

  return games;
}
