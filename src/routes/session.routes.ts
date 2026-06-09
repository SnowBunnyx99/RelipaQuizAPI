import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { generateJoinCode } from "../lib/joinCode.js";

export const sessionRouter = Router();

function joinUrl(joinCode: string) {
  return `${env.CLIENT_URL.replace(/\/$/, "")}/join/${joinCode}`;
}

async function uniqueJoinCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateJoinCode();
    const existing = await prisma.gameSession.findUnique({ where: { joinCode: code } });
    if (!existing) return code;
  }
  // extremely unlikely; widen the space
  return generateJoinCode(8);
}

// POST /api/sessions — start a new live game for a quiz
const createSchema = z.object({ quizId: z.string().min(1) });

sessionRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide { quizId }" });

  const quiz = await prisma.quiz.findUnique({
    where: { id: parsed.data.quizId },
    include: { _count: { select: { questions: true } } },
  });
  if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  if (quiz._count.questions === 0)
    return res.status(400).json({ error: "Quiz has no questions" });

  const joinCode = await uniqueJoinCode();
  const session = await prisma.gameSession.create({
    data: { quizId: quiz.id, joinCode },
  });

  const url = joinUrl(joinCode);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });

  res.status(201).json({
    session,
    quizTitle: quiz.title,
    questionCount: quiz._count.questions,
    joinCode,
    joinUrl: url,
    qrDataUrl,
  });
});

// GET /api/sessions/:id — session + quiz title + participants
sessionRouter.get("/:id", async (req, res) => {
  const session = await prisma.gameSession.findUnique({
    where: { id: req.params.id },
    include: {
      quiz: { select: { title: true, _count: { select: { questions: true } } } },
      participants: { orderBy: { score: "desc" } },
    },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({
    ...session,
    joinUrl: joinUrl(session.joinCode),
  });
});

// GET /api/sessions/code/:code — resolve a join code (used by the player page)
sessionRouter.get("/code/:code", async (req, res) => {
  const session = await prisma.gameSession.findUnique({
    where: { joinCode: req.params.code.toUpperCase() },
    include: { quiz: { select: { title: true } } },
  });
  if (!session) return res.status(404).json({ error: "Game not found" });
  res.json({
    id: session.id,
    joinCode: session.joinCode,
    status: session.status,
    quizTitle: session.quiz.title,
  });
});

// GET /api/sessions/:id/qr — QR code PNG for the join link
sessionRouter.get("/:id/qr", async (req, res) => {
  const session = await prisma.gameSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: "Session not found" });
  const png = await QRCode.toBuffer(joinUrl(session.joinCode), { width: 320, margin: 1 });
  res.type("png").send(png);
});
