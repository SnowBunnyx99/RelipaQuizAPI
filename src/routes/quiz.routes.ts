import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parseQuizCsv } from "../lib/csv.js";

export const quizRouter = Router();

const optionSchema = z.object({
  text: z.string().min(1),
  isCorrect: z.boolean().default(false),
});

const questionSchema = z.object({
  text: z.string().min(1),
  timeLimit: z.number().int().min(5).max(300).default(20),
  points: z.number().int().min(0).max(100000).default(1000),
  options: z.array(optionSchema).min(2).max(6),
});

const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  questions: z.array(questionSchema).min(1),
});

function validateCorrect(questions: z.infer<typeof questionSchema>[]): string | null {
  for (let i = 0; i < questions.length; i++) {
    const correct = questions[i].options.filter((o) => o.isCorrect).length;
    if (correct < 1) return `Question ${i + 1} has no correct option marked.`;
  }
  return null;
}

async function persistQuiz(input: z.infer<typeof createQuizSchema>) {
  return prisma.quiz.create({
    data: {
      title: input.title,
      description: input.description,
      questions: {
        create: input.questions.map((q, qi) => ({
          order: qi,
          text: q.text,
          // a question with more than one correct option is a multi-answer question
          type: q.options.filter((o) => o.isCorrect).length > 1 ? "MULTIPLE" : "SINGLE",
          timeLimit: q.timeLimit,
          points: q.points,
          options: {
            create: q.options.map((o, oi) => ({
              order: oi,
              text: o.text,
              isCorrect: o.isCorrect,
            })),
          },
        })),
      },
    },
    include: { questions: { include: { options: true }, orderBy: { order: "asc" } } },
  });
}

// POST /api/quizzes — create a quiz from JSON
quizRouter.post("/", async (req, res) => {
  const parsed = createQuizSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid quiz", details: z.treeifyError(parsed.error) });
  }
  const err = validateCorrect(parsed.data.questions);
  if (err) return res.status(400).json({ error: err });

  const quiz = await persistQuiz(parsed.data);
  res.status(201).json(quiz);
});

// POST /api/quizzes/import — create a quiz from a CSV payload
const importSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  csv: z.string().min(1),
});

quizRouter.post("/import", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Provide { title, csv }", details: z.treeifyError(parsed.error) });
  }
  const { questions, errors } = parseQuizCsv(parsed.data.csv);
  if (questions.length === 0) {
    return res.status(400).json({ error: "No valid questions found in CSV", csvErrors: errors });
  }

  const quiz = await persistQuiz({
    title: parsed.data.title,
    description: parsed.data.description,
    questions: questions.map((q) => ({
      text: q.text,
      timeLimit: q.timeLimit,
      points: q.points,
      options: q.options,
    })),
  });

  res.status(201).json({ quiz, imported: questions.length, warnings: errors });
});

// GET /api/quizzes — list
quizRouter.get("/", async (_req, res) => {
  const quizzes = await prisma.quiz.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { questions: true } } },
  });
  res.json(quizzes);
});

// GET /api/quizzes/:id — full quiz
quizRouter.get("/:id", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: req.params.id },
    include: { questions: { include: { options: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } } },
  });
  if (!quiz) return res.status(404).json({ error: "Quiz not found" });
  res.json(quiz);
});

// DELETE /api/quizzes/:id
quizRouter.delete("/:id", async (req, res) => {
  await prisma.quiz.delete({ where: { id: req.params.id } }).catch(() => {});
  res.status(204).end();
});
