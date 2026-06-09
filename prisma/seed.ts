import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/prisma.js";
import { parseQuizCsv } from "../src/lib/csv.js";

// Seeds one quiz from sample-quiz.csv so you have something to host immediately.
async function main() {
  const csv = readFileSync(join(process.cwd(), "sample-quiz.csv"), "utf8");
  const { questions, errors } = parseQuizCsv(csv);
  if (errors.length) console.warn("CSV warnings:", errors);
  if (!questions.length) throw new Error("No questions parsed from sample-quiz.csv");

  const quiz = await prisma.quiz.create({
    data: {
      title: "Sample Trivia Quiz",
      description: "Seeded from sample-quiz.csv",
      questions: {
        create: questions.map((q, qi) => ({
          order: qi,
          text: q.text,
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
  });

  console.log(`Seeded quiz "${quiz.title}" (${questions.length} questions) id=${quiz.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
