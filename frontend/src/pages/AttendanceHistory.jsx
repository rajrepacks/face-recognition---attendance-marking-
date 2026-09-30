import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

function formatDate(value) {
  if (!value) return "-";

  const parsed = new Date(`${value}T00:00:00`);

  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function formatTime(value) {
  if (!value) return "-";

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleTimeString();
}

export default function AttendanceHistory() {
  const [students, setStudents] = useState([]);
  const [history, setHistory] = useState(null);
  const [className, setClassName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const classes = useMemo(
    () => [...new Set(students.map((student) => student.class_name))].sort(),
    [students]
  );

  const availableStudents = useMemo(() => {
    if (!className) return students;

    return students.filter((student) => student.class_name === className);
  }, [students, className]);

  useEffect(() => {
    api
      .listStudents()
      .then((data) => setStudents(data))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      setError("");

      try {
        const data = await api.attendanceHistory({
          className: className || undefined,
          studentId: studentId ? Number(studentId) : undefined,
          date: date || undefined,
        });

        if (!cancelled) {
          setHistory(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [className, studentId, date]);

  const records = history?.records ?? [];

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="text-lg font-semibold">Attendance history</h2>

        <p className="mt-1 text-sm text-slate-500">
          View each student&apos;s present or absent status for every attendance session.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="history-class">
              Class
            </label>

            <select
              id="history-class"
              className="field"
              value={className}
              onChange={(event) => {
                setClassName(event.target.value);
                setStudentId("");
              }}
            >
              <option value="">All classes</option>

              {classes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="history-student">
              Student
            </label>

            <select
              id="history-student"
              className="field"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="">All students</option>

              {availableStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.roll_no} — {student.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="history-date">
              Session date
            </label>

            <input
              id="history-date"
              className="field"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>

        <button
          className="btn-secondary mt-4"
          onClick={() => {
            setClassName("");
            setStudentId("");
            setDate("");
          }}
        >
          Clear filters
        </button>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-slate-500">Total records</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">
            {history?.total_records ?? 0}
          </p>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500">Present</p>
          <p className="mt-1 text-3xl font-bold text-emerald-600">
            {history?.present_count ?? 0}
          </p>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500">Absent</p>
          <p className="mt-1 text-3xl font-bold text-rose-600">
            {history?.absent_count ?? 0}
          </p>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Session records</h2>

          {loading && (
            <span className="text-sm text-slate-500">Loading attendance...</span>
          )}
        </div>

        {!loading && records.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No attendance history matches the selected filters.
          </p>
        ) : (
          <table className="mt-4 min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Class</th>
                <th className="px-3 py-3">Roll no.</th>
                <th className="px-3 py-3">Student</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Marked at</th>
                <th className="px-3 py-3">Confidence</th>
              </tr>
            </thead>

            <tbody>
              {records.map((record) => (
                <tr
                  key={`${record.session_id}-${record.student.id}`}
                  className="border-b border-slate-100"
                >
                  <td className="px-3 py-3">{formatDate(record.date)}</td>
                  <td className="px-3 py-3">{record.class_name}</td>
                  <td className="px-3 py-3 font-mono">{record.student.roll_no}</td>
                  <td className="px-3 py-3 font-medium">{record.student.name}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        record.status === "present"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {record.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">{formatTime(record.marked_at)}</td>
                  <td className="px-3 py-3">
                    {record.confidence === null || record.confidence === undefined
                      ? "-"
                      : `${(record.confidence * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}