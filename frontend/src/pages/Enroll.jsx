import { useCallback, useEffect, useRef, useState } from "react";
import WebcamCapture from "../components/WebcamCapture.jsx";
import { api } from "../lib/api.js";

const REQUIRED_SAMPLES = 5;

export default function Enroll() {
  const camera = useRef(null);
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [samples, setSamples] = useState([]); // { accepted, message, prob, latency }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setStudents(await api.listStudents());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accepted = samples.filter((s) => s.accepted).length;
  const student = students.find((s) => String(s.id) === String(studentId));
  const done = accepted >= REQUIRED_SAMPLES;

  function onSelect(event) {
    setStudentId(event.target.value);
    setSamples([]);
    setError("");
  }

  async function captureSample() {
    if (!studentId || busy || done) return;
    setError("");

    const image = camera.current && camera.current.capture();
    if (!image) {
      setError("Camera is not ready yet.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.enroll(Number(studentId), [image]);
      const sample = result.results[0];
      setSamples((prev) => [
        ...prev,
        {
          accepted: true,
          message: `Accepted (detection ${(sample.detection_prob * 100).toFixed(1)}%)`,
          latency: sample.latency_ms,
        },
      ]);
      await load();
    } catch (err) {
      setSamples((prev) => [...prev, { accepted: false, message: err.message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h2 className="text-lg font-semibold">Enroll a face</h2>
        <p className="mt-1 text-sm text-slate-500">
          Capture {REQUIRED_SAMPLES} samples. Vary the angle and expression slightly between shots.
        </p>

        <div className="mt-4">
          <label className="label" htmlFor="student">
            Student
          </label>
          <select id="student" className="field" value={studentId} onChange={onSelect}>
            <option value="">Select a student...</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.roll_no} - {s.name} ({s.class_name})
                {s.enrolled ? ` - ${s.encoding_count} encodings` : " - not enrolled"}
              </option>
            ))}
          </select>
        </div>

        <WebcamCapture ref={camera} className="mt-4" />

        <div className="mt-4 flex items-center gap-3">
          <button className="btn" onClick={captureSample} disabled={!studentId || busy || done}>
            {busy ? "Processing..." : `Capture sample ${Math.min(accepted + 1, REQUIRED_SAMPLES)}`}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setSamples([])}
            disabled={busy || samples.length === 0}
          >
            Reset
          </button>
          <span className="text-sm text-slate-500">
            {accepted}/{REQUIRED_SAMPLES} accepted
          </span>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {done && (
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {student ? student.name : "Student"} is enrolled. Head to Mark Attendance.
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Sample log</h2>
        <p className="mt-1 text-sm text-slate-500">
          Rejected samples show the exact reason returned by the recognition engine.
        </p>

        <div className="mt-4 space-y-2">
          {[...Array(REQUIRED_SAMPLES)].map((_, index) => {
            const filled = index < accepted;
            return (
              <div
                key={index}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                  filled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <span className="font-mono text-xs">#{index + 1}</span>
                <span>{filled ? "Captured" : "Waiting"}</span>
              </div>
            );
          })}
        </div>

        {samples.length > 0 && (
          <ul className="mt-5 space-y-2 text-sm">
            {samples
              .slice()
              .reverse()
              .map((sample, index) => (
                <li
                  key={samples.length - index}
                  className={`rounded-md px-3 py-2 ${
                    sample.accepted ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                  }`}
                >
                  <span className="font-medium">
                    {sample.accepted ? "Accepted" : "Rejected"}:
                  </span>{" "}
                  {sample.message}
                  {sample.latency && (
                    <span className="ml-1 text-xs text-slate-500">
                      (detect {sample.latency.detect} ms / embed {sample.latency.embed} ms)
                    </span>
                  )}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
