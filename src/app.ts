import express from "express";
import cors from "cors";
import { quizRouter } from "./routes/quiz.routes.js";
import { sessionRouter } from "./routes/session.routes.js";
import { statsRouter } from "./routes/stats.routes.js";

export function createApp() {
  const app = express();

  // Dev: reflect the request origin so the app works whether it's opened via
  // localhost (laptop) or the LAN IP (phone on the same Wi-Fi).
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  app.use("/api/quizzes", quizRouter);
  app.use("/api/sessions", sessionRouter);
  app.use("/api/sessions", statsRouter); // GET /api/sessions/:id/stats

  // fallthrough error handler
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
