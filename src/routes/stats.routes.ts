import { Router } from "express";
import { prisma } from "../prisma.js";

export const statsRouter = Router();

// GET /api/sessions/:id/stats — post-game statistics computed from the DB.
// Works after a game finishes (answers are persisted at each reveal).
statsRouter.get("/:id/stats", async (req, res) => {
  const session = await prisma.gameSession.findUnique({
    where: { id: req.params.id },
    include: {
      quiz: {
        include: {
          questions: {
            orderBy: { order: "asc" },
            include: { options: { orderBy: { order: "asc" } } },
          },
        },
      },
      participants: { orderBy: { score: "desc" } },
      answers: true,
    },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const leaderboard = session.participants.map((p, i) => ({
    participantId: p.id,
    nickname: p.nickname,
    score: p.score,
    rank: i + 1,
  }));

  const answersByQuestion = new Map<string, typeof session.answers>();
  for (const a of session.answers) {
    const list = answersByQuestion.get(a.questionId) ?? [];
    list.push(a);
    answersByQuestion.set(a.questionId, list);
  }

  const questionStats = session.quiz.questions.map((q) => {
    const answers = answersByQuestion.get(q.id) ?? [];
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const totalAnswers = answers.length;
    const totalTime = answers.reduce((s, a) => s + a.timeTakenMs, 0);
    const tally = q.options.map((o) => ({
      optionId: o.id,
      order: o.order,
      text: o.text,
      isCorrect: o.isCorrect,
      count: answers.filter((a) => a.optionId === o.id).length,
    }));
    return {
      questionId: q.id,
      text: q.text,
      points: q.points,
      timeLimit: q.timeLimit,
      correctCount,
      totalAnswers,
      accuracy: totalAnswers ? correctCount / totalAnswers : 0,
      averageTimeMs: totalAnswers ? Math.round(totalTime / totalAnswers) : 0,
      tally,
    };
  });

  // hardest / easiest by accuracy (only questions that got answers)
  const answered = questionStats.filter((q) => q.totalAnswers > 0);
  const sortedByAccuracy = [...answered].sort((a, b) => a.accuracy - b.accuracy);

  res.json({
    sessionId: session.id,
    quizTitle: session.quiz.title,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    totalPlayers: session.participants.length,
    totalQuestions: session.quiz.questions.length,
    leaderboard,
    questionStats,
    hardestQuestion: sortedByAccuracy[0] ?? null,
    easiestQuestion: sortedByAccuracy[sortedByAccuracy.length - 1] ?? null,
  });
});
