# Relipa Quiz

A real-time, multiplayer quiz app (Quiz.com / Kahoot style), split into two apps:

- **`RelipaQuizAPI/`** (this folder) — Node.js + TypeScript + Express + **Socket.IO** + **Prisma/PostgreSQL** backend.
- **`../RelipaQuizApp/`** — Next.js 16 frontend (host console + player screens).

## Features

- Host launches a live game from a quiz; players join in real time (Socket.IO).
- **CSV import** of quizzes (see `sample-quiz.csv`).
- **Timed questions**, configurable per question (time limit + points).
- Real-time answering with **speed-based scoring** (faster correct answers earn more).
- Live **leaderboard** and **podium**.
- Post-game **statistics** (per-question accuracy, hardest/easiest, answer distribution).
- Players join by **link or QR code** — the QR just encodes the join URL.

---

## 1. Backend setup (`RelipaQuizAPI`)

```bash
cd RelipaQuizAPI

# 1. Set your real Postgres credentials in .env
#    DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/relipa_quiz?schema=public"

# 2. Create the database schema (also creates the DB if missing)
npx prisma migrate dev --name init

# 3. (optional) Seed a sample quiz from sample-quiz.csv
npm run db:seed

# 4. Run the API + Socket.IO server (http://localhost:4000)
npm run dev
```

> Prisma 7 note: the connection URL lives in `prisma.config.ts` (for migrations)
> and the runtime client connects via the `@prisma/adapter-pg` driver adapter in
> `src/prisma.ts`. There is intentionally no `url` in `schema.prisma`.

### Backend env (`.env`)

| var          | meaning                                              |
| ------------ | ---------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string                         |
| `PORT`         | API port (default 4000)                            |
| `CLIENT_URL`   | Frontend origin — used for CORS and join/QR links  |

---

## 2. Frontend setup (`../RelipaQuizApp`)

```bash
cd ../RelipaQuizApp

# .env.local already points at the API:
#   NEXT_PUBLIC_API_URL=http://localhost:4000

npm run dev      # http://localhost:3000
```

---

## 3. Play

1. Open **http://localhost:3000** → **Host a Quiz**.
2. Import `sample-quiz.csv` (or use the "Use sample" button), then click **▶ Host**.
3. The host lobby shows a **Game PIN + QR code**.
4. On another device/tab open **http://localhost:3000/join**, enter the PIN (or scan the QR), pick a nickname.
5. Host clicks **Start game**. Answer questions before the timer runs out.
6. After the last question, open **View statistics** for the breakdown.

---

## CSV format

Header row required (case-insensitive):

```
question, timeLimit, points, option1, option2, option3, option4, correct
```

- `timeLimit` (seconds, default 20) and `points` (default 1000) are optional.
- 2–6 options (`option1`…`option6`); blank option columns are ignored.
- `correct` is the **1-based option number** (e.g. `2`) **or a letter** (`B`).

Example:

```csv
question,timeLimit,points,option1,option2,option3,option4,correct
"What is 2 + 2?",15,1000,3,4,5,22,2
```

---

## Architecture notes

- A **`Quiz`** is a reusable template (`Question` + `AnswerOption`). A **`GameSession`**
  is one live run that **`Participant`s** join and submit **`Answer`s** to.
- The backend keeps **authoritative live game state in memory** (`src/game/GameManager.ts`)
  with server-side timers, and persists participants/answers/scores to Postgres so the
  stats endpoint can recompute everything after the game.
- The real-time contract (event names + payload types) lives in `src/shared/events.ts`
  and is mirrored on the frontend in `app/lib/events.ts`.
- Socket.IO's built-in heartbeat (ping/pong) handles liveness; players reconnecting in
  the same browser auto-rejoin via a stored participant id.
```
