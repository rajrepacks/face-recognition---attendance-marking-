# Face Recognition Attendance System

Standalone attendance system: register a student, enroll their face, recognise them from a
webcam feed, and watch the present list fill up live.

This repository is self-contained — its own database, its own API, no dependency on any other
codebase. It mirrors SchoolSync conventions (FastAPI + async SQLAlchemy + PostgreSQL, React /
Vite / Tailwind, REST under `/api`) and keeps `roll_no` on every student so records can be
reconciled with an external system later.

**Phase 1 scope (this release):** one vertical slice — register → enroll → recognise → record →
live present list. No dashboard, no manual marking, no session history, no reporting.

---

## How it works

| Stage | Component |
| --- | --- |
| Detection | MTCNN (`facenet-pytorch`), OpenCV for decoding/colour conversion |
| Recognition | Pre-trained FaceNet `InceptionResnetV1` (`vggface2`) → 512-d embedding |
| Matching | Embeddings are L2-normalised, so cosine similarity is a single matrix multiply |
| Storage | Encodings stored as raw `float32` bytes in `face_encodings.vector` (BYTEA) |

Both models are loaded **once** at startup into `app.state.face_engine`. Every known encoding is
held in memory as one `(N, 512)` matrix with a parallel `student_id` list; matching is
`matrix @ vector`, never a Python loop. The cache is refreshed after each enrollment.

Detect / embed / match latency is logged in ms and returned by the recognise endpoint.

---

## Prerequisites

- Python 3.11
- Node.js 18+
- PostgreSQL 14+ running locally (or anywhere reachable)

---

## Backend setup

```bash
cd backend

python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Create the database:

```bash
createdb face_attendance
# or: psql -U postgres -c "CREATE DATABASE face_attendance;"
```

Configure the environment:

```bash
cp .env.example .env
```

`.env` — the driver **must** be `asyncpg`:

```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/face_attendance
CORS_ORIGINS=http://localhost:5173
FACE_MATCH_THRESHOLD=0.65
FACE_MIN_DETECTION_PROB=0.90
FACE_DETECTION_FLOOR=0.60
```

Run it:

```bash
uvicorn app.main:app --reload --port 8000
```

Tables are created on startup with `Base.metadata.create_all` (Alembic comes in a later phase).
Interactive docs: <http://localhost:8000/docs>

> **First run downloads the FaceNet weights (~110 MB)** to the torch cache
> (`%USERPROFILE%\.cache\torch\checkpoints` on Windows, `~/.cache/torch/checkpoints` elsewhere).
> Startup will look like it is hanging — it is downloading. Later runs load from disk in a few
> seconds. The machine needs internet access for that first start.

---

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The API base URL defaults to `http://localhost:8000/api`; override
it with `VITE_API_BASE` in `frontend/.env` if the backend runs elsewhere.

The camera only works on `localhost` or over HTTPS — that is a browser rule, not an app one.

---

## Using it

1. **Students** — add a student (roll no, name, class). The table shows enrolled vs not enrolled.
2. **Enroll** — pick the student, capture 5 samples. Each sample is sent to the server on its own,
   so a rejection shows the real reason (no face / multiple faces / detection confidence too low).
3. **Mark Attendance** — pick the class, start the session. A frame is sent every 2 seconds; a
   recognised student is written to `attendance_records` once (UNIQUE on `session_id, student_id`)
   and appears in the live present list with the match confidence. Unknown faces raise a toast.

---

## API

All routes are under `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/students` | Create a student |
| `GET` | `/students` | List students with `enrolled: true/false` |
| `POST` | `/faces/enroll` | `{student_id, images: [dataURL]}` → store encodings |
| `POST` | `/attendance/sessions` | `{class_name}` → create or return today's open session |
| `POST` | `/attendance/sessions/{id}/recognize` | `{image}` → match, insert record if new |
| `GET` | `/attendance/sessions/{id}/live` | Present list + absent list for that class |

`recognize` always returns HTTP 200 with a `reason` so a 2-second polling loop is not fighting
error codes:

```json
{
  "matched": true,
  "student": { "id": 1, "roll_no": "22CS101", "name": "Jose", "class_name": "CS-3A", "created_at": "..." },
  "confidence": 0.81,
  "already_marked": false,
  "reason": "matched",
  "latency_ms": { "detect": 148.3, "embed": 61.2, "match": 0.14, "total": 212.9 }
}
```

`reason` is one of `matched`, `unknown_face`, `no_face`, `multiple_faces`, `low_detection_prob`,
`invalid_image`, `no_encodings`.

---

## Data model

| Table | Columns |
| --- | --- |
| `students` | `id`, `roll_no` (unique), `name`, `class_name`, `created_at` |
| `face_encodings` | `id`, `student_id` FK, `vector` BYTEA (512 × float32), `created_at` — many per student |
| `attendance_sessions` | `id`, `class_name`, `date`, `started_at`, `ended_at` (nullable) |
| `attendance_records` | `id`, `session_id` FK, `student_id` FK, `marked_at`, `confidence`, UNIQUE(`session_id`, `student_id`) |

---

## Tuning the threshold

`FACE_MATCH_THRESHOLD` is the cosine similarity a face must reach to be accepted as a match.
It starts at **0.65**.

- **Too many false matches** (the wrong student gets marked) → raise it: `0.70`, `0.75`.
- **A known student is never recognised** → lower it: `0.60`, `0.55`, and enroll more samples
  under the lighting the room actually has.
- Cosine similarity here runs roughly 0.75–0.95 for the same person and 0.2–0.5 for different
  people, so there is a wide usable band. Read the real numbers off the `confidence` field —
  `unknown_face` responses still report the best score they saw, which is the fastest way to pick
  a threshold for a given room and camera.

Two related knobs:

- `FACE_MIN_DETECTION_PROB` (0.90) — MTCNN confidence needed before a detection is used at all.
  Lower it for poor lighting; raise it to reject blurry frames during enrollment.
- `FACE_DETECTION_FLOOR` (0.60) — boxes below this are ignored entirely, so a background artefact
  is not counted as a second face.

Restart the backend after changing `.env`.

---

## Layout

```
face-attendance/
  backend/
    app/
      main.py          FastAPI app, lifespan: create tables, load models, warm the cache
      config.py        Pydantic settings (.env)
      database.py      Async engine, session factory, create_all
      models.py        SQLAlchemy models for the four tables
      schemas.py       Pydantic v2 request/response models
      face/engine.py   MTCNN + FaceNet, encoding cache, matching, latency
      routers/         students.py, faces.py, attendance.py
    requirements.txt
    .env.example
  frontend/
    src/
      pages/           Students.jsx, Enroll.jsx, MarkAttendance.jsx
      components/      WebcamCapture.jsx
      lib/api.js       fetch wrapper
    package.json, vite.config.js, tailwind.config.js, postcss.config.js
  README.md
```
