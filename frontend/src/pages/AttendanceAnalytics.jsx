import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

function percentageTextColor(value) {
  if (value >= 75) return "text-emerald-600";
  if (value >= 60) return "text-amber-600";
  return "text-rose-600";
}

function percentageBarColor(value) {
  if (value >= 75) return "bg-emerald-500";
  if (value >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

export default function AttendanceAnalytics() {
  const [students, setStudents] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [className, setClassName] = useState("");
  const [studentId, setStudentId] = useState("");
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

    async function loadAnalytics() {
      setLoading(true);
      setError("");

      try {
        const data = await api.attendanceAnalytics({
          className: className || undefined,
          studentId: studentId ? Number(studentId) : undefined,
        });

        if (!cancelled) {
          setAnalytics(data);
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

    loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [className, studentId]);

  const summary = analytics?.summary;

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="text-lg font-semibold">Attendance analytics</h2>

        <p className="mt-1 text-sm text-slate-500">
          Analyze attendance rates by class, student, and date.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="analytics-class">
              Class
            </label>

            <select
              id="analytics-class"
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
            <label className="label" htmlFor="analytics-student">
              Student
            </label>

            <select
              id="analytics-student"
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
        </div>

        <button
          className="btn-secondary mt-4"
          onClick={() => {
            setClassName("");
            setStudentId("");
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

      {loading || !summary ? (
        <section className="card">
          <p className="text-sm text-slate-500">Loading analytics...</p>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card">
              <p className="text-sm text-slate-500">Attendance rate</p>
              <p
                className={`mt-1 text-3xl font-bold ${percentageTextColor(
                  summary.attendance_percentage
                )}`}
              >
                {summary.attendance_percentage.toFixed(1)}%
              </p>
            </div>

            <div className="card">
              <p className="text-sm text-slate-500">Sessions</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {summary.total_sessions}
              </p>
            </div>

            <div className="card">
              <p className="text-sm text-slate-500">Students</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {summary.total_students}
              </p>
            </div>

            <div className="card">
              <p className="text-sm text-slate-500">Present records</p>
              <p className="mt-1 text-3xl font-bold text-emerald-600">
                {summary.total_present} / {summary.total_possible_attendance}
              </p>
            </div>
          </section>

          <section className="card overflow-x-auto">
            <h2 className="text-lg font-semibold">Class summary</h2>

            {analytics.class_summary.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No attendance sessions are available.
              </p>
            ) : (
              <table className="mt-4 min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Class</th>
                    <th className="px-3 py-3">Students</th>
                    <th className="px-3 py-3">Sessions</th>
                    <th className="px-3 py-3">Present</th>
                    <th className="px-3 py-3">Attendance</th>
                  </tr>
                </thead>

                <tbody>
                  {analytics.class_summary.map((item) => (
                    <tr key={item.class_name} className="border-b border-slate-100">
                      <td className="px-3 py-3 font-medium">{item.class_name}</td>
                      <td className="px-3 py-3">{item.total_students}</td>
                      <td className="px-3 py-3">{item.total_sessions}</td>
                      <td className="px-3 py-3">
                        {item.total_present} / {item.total_possible_attendance}
                      </td>
                      <td className="px-3 py-3">
                        <div className="min-w-36">
                          <p
                            className={`text-xs font-medium ${percentageTextColor(
                              item.attendance_percentage
                            )}`}
                          >
                            {item.attendance_percentage.toFixed(1)}%
                          </p>

                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${percentageBarColor(
                                item.attendance_percentage
                              )}`}
                              style={{
                                width: `${Math.min(item.attendance_percentage, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card overflow-x-auto">
            <h2 className="text-lg font-semibold">Student summary</h2>

            {analytics.student_summary.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No student attendance data is available.
              </p>
            ) : (
              <table className="mt-4 min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Roll no.</th>
                    <th className="px-3 py-3">Student</th>
                    <th className="px-3 py-3">Class</th>
                    <th className="px-3 py-3">Present</th>
                    <th className="px-3 py-3">Absent</th>
                    <th className="px-3 py-3">Attendance</th>
                  </tr>
                </thead>

                <tbody>
                  {analytics.student_summary.map((item) => (
                    <tr key={item.student.id} className="border-b border-slate-100">
                      <td className="px-3 py-3 font-mono">{item.student.roll_no}</td>
                      <td className="px-3 py-3 font-medium">{item.student.name}</td>
                      <td className="px-3 py-3">{item.student.class_name}</td>
                      <td className="px-3 py-3 text-emerald-700">{item.present_count}</td>
                      <td className="px-3 py-3 text-rose-700">{item.absent_count}</td>
                      <td
                        className={`px-3 py-3 font-medium ${percentageTextColor(
                          item.attendance_percentage
                        )}`}
                      >
                        {item.attendance_percentage.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card overflow-x-auto">
            <h2 className="text-lg font-semibold">Daily trend</h2>

            {analytics.daily_summary.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No daily attendance data is available.
              </p>
            ) : (
              <table className="mt-4 min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Sessions</th>
                    <th className="px-3 py-3">Present</th>
                    <th className="px-3 py-3">Attendance rate</th>
                  </tr>
                </thead>

                <tbody>
                  {analytics.daily_summary.map((item) => (
                    <tr key={item.date} className="border-b border-slate-100">
                      <td className="px-3 py-3">{item.date}</td>
                      <td className="px-3 py-3">{item.total_sessions}</td>
                      <td className="px-3 py-3">
                        {item.total_present} / {item.total_possible_attendance}
                      </td>
                      <td
                        className={`px-3 py-3 font-medium ${percentageTextColor(
                          item.attendance_percentage
                        )}`}
                      >
                        {item.attendance_percentage.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}