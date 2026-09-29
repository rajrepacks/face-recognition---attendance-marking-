import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WebcamCapture from "../components/WebcamCapture.jsx";
import { api } from "../lib/api.js";

const CAPTURE_INTERVAL_MS = 2000;
const UNKNOWN_TOAST_COOLDOWN_MS = 5000;

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString();
}

export default function MarkAttendance() {
  const camera = useRef(null);
  const busyRef = useRef(false);
  const toastId = useRef(0);
  const lastUnknownToastTime = useRef(0);

  const [students, setStudents] = useState([]);
  const [className, setClassName] = useState("");
  const [session, setSession] = useState(null);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(null);
  const [latency, setLatency] = useState(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState([]);

  const classes = useMemo(
    () => [...new Set(students.map((s) => s.class_name))].sort(),
    [students]
  );

  const pushToast = useCallback((kind, text) => {
    toastId.current += 1;
    const id = toastId.current;

    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    api
      .listStudents()
      .then((data) => {
        setStudents(data);

        const firstClass = [...new Set(data.map((s) => s.class_name))].sort()[0];

        if (firstClass) {
          setClassName((current) => current || firstClass);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const refreshLive = useCallback(async (sessionId) => {
    try {
      setLive(await api.live(sessionId));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  async function startSession() {
    if (!className) return;

    setError("");

    try {
      const created = await api.startSession(className);

      setSession(created);
      setRunning(true);

      await refreshLive(created.id);
    } catch (err) {
      setError(err.message);
    }
  }

  // Sends a frame to the backend every two seconds while capture is enabled.
  useEffect(() => {
    if (!running || !session) return undefined;

    let cancelled = false;

    const timer = setInterval(async () => {
      if (busyRef.current) return;

      const image = camera.current?.capture();

      if (!image) return;

      busyRef.current = true;

      try {
        const result = await api.recognize(session.id, image);

        if (cancelled) return;

        setLatency(result.latency_ms);

        if (result.matched && !result.already_marked) {
          pushToast(
            "success",
            `${result.student.name} marked present (${(result.confidence * 100).toFixed(1)}%)`
          );

          await refreshLive(session.id);
        } else if (result.reason === "unknown_face") {
          const now = Date.now();

          if (now - lastUnknownToastTime.current >= UNKNOWN_TOAST_COOLDOWN_MS) {
            lastUnknownToastTime.current = now;

            pushToast(
              "warn",
              `Unknown face - best match ${(result.confidence * 100).toFixed(1)}% is below the threshold`
            );
          }
        } else if (result.reason === "multiple_faces") {
          pushToast("warn", "More than one face in frame");
        } else if (result.reason === "no_encodings") {
          pushToast("warn", "No enrolled faces yet - enroll a student first");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        busyRef.current = false;
      }
    }, CAPTURE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, session, pushToast, refreshLive]);

  // Refresh the present/absent roster every 10 seconds during an active session.
  useEffect(() => {
    if (!running || !session) return undefined;

    const timer = setInterval(() => {
      refreshLive(session.id);
    }, 10000);

    return () => clearInterval(timer);
  }, [running, session, refreshLive]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h2 className="text-lg font-semibold">Mark attendance</h2>

        <p className="mt-1 text-sm text-slate-500">
          A frame is sent every {CAPTURE_INTERVAL_MS / 1000}s while the session is running.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="label" htmlFor="class">
              Class
            </label>

            <select
              id="class"
              className="field"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              disabled={Boolean(session)}
            >
              <option value="">Select a class...</option>

              {classes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {!session ? (
            <button className="btn" onClick={startSession} disabled={!className}>
              Start session
            </button>
          ) : (
            <button
              className="btn-secondary"
              onClick={() => setRunning((value) => !value)}
            >
              {running ? "Pause capture" : "Resume capture"}
            </button>
          )}
        </div>

        <WebcamCapture ref={camera} className="mt-4" />

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>
            {session
              ? `Session #${session.id} - ${session.class_name} - ${session.date}`
              : "No session started"}
          </span>

          {latency && (
            <span className="font-mono">
              detect {latency.detect ?? "-"} / embed {latency.embed ?? "-"} / match{" "}
              {latency.match ?? "-"} / total {latency.total} ms
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Present</h2>

          <span className="text-sm text-slate-500">
            {live ? `${live.present_count} present / ${live.absent_count} absent` : "-"}
          </span>
        </div>

        {!live || live.present.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nobody marked yet. Look at the camera and hold still.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {live.present.map((entry) => (
              <li
                key={entry.student.id}
                className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-emerald-900">
                    {entry.student.name}
                  </p>

                  <p className="font-mono text-xs text-emerald-700">
                    {entry.student.roll_no}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-emerald-800">
                    {(entry.confidence * 100).toFixed(1)}%
                  </p>

                  <p className="text-xs text-emerald-700">
                    {formatTime(entry.marked_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {live && live.absent.length > 0 && (
          <>
            <h3 className="mt-6 text-sm font-semibold text-slate-700">
              Not yet marked
            </h3>

            <ul className="mt-2 flex flex-wrap gap-2">
              {live.absent.map((student) => (
                <li
                  key={student.id}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600"
                >
                  {student.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-md px-4 py-3 text-sm shadow-lg ${
              toast.kind === "success"
                ? "bg-emerald-600 text-white"
                : "bg-amber-500 text-white"
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}