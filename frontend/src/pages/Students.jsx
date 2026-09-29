import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

const EMPTY = { roll_no: "", name: "", class_name: "" };

export default function Students() {
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setStudents(await api.listStudents());
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(""); setNotice("");
    try {
      const created = await api.createStudent({
        roll_no: form.roll_no.trim(),
        name: form.name.trim(),
        class_name: form.class_name.trim(),
      });
      setNotice(`${created.name} (${created.roll_no}) added.`);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(student) {
    setDeletingId(student.id);
    setError(""); setNotice("");
    try {
      await api.deleteStudent(student.id);
      setNotice(`${student.name} removed successfully.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const valid = form.roll_no.trim() && form.name.trim() && form.class_name.trim();

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <section className="card h-fit">
        <h2 className="text-lg font-semibold">Register a student</h2>
        <p className="mt-1 text-sm text-slate-500">
          The roll number is unique and is what an external system reconciles against.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="roll_no">Roll number</label>
            <input id="roll_no" className="field" value={form.roll_no}
              onChange={update("roll_no")} placeholder="22CS101" autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="field" value={form.name}
              onChange={update("name")} placeholder="Jose Mathew" autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="class_name">Class</label>
            <input id="class_name" className="field" value={form.class_name}
              onChange={update("class_name")} placeholder="CS-3A" autoComplete="off" />
          </div>
          <button className="btn w-full" type="submit" disabled={!valid || saving}>
            {saving ? "Saving..." : "Add student"}
          </button>
        </form>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Students</h2>
          <span className="text-sm text-slate-500">
            {students.filter((s) => s.enrolled).length} of {students.length} enrolled
          </span>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading...</p>
        ) : students.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No students yet. Add one on the left.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Roll no</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Class</th>
                  <th className="py-2 pr-4">Face status</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{student.roll_no}</td>
                    <td className="py-2 pr-4">{student.name}</td>
                    <td className="py-2 pr-4">{student.class_name}</td>
                    <td className="py-2 pr-4">
                      {student.enrolled ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Enrolled ({student.encoding_count})
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Not enrolled
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      {confirmId === student.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Sure?</span>
                          <button
                            onClick={() => onDelete(student)}
                            disabled={deletingId === student.id}
                            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingId === student.id ? "Removing..." : "Yes, remove"}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(student.id)}
                          className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-100"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}