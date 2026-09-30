const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

/** Pull a human readable message out of a FastAPI error body. */
function errorMessage(status, body) {
  const detail = body && body.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail) && detail.length && detail[0]?.msg) {
    return detail.map((item) => item.msg).join(", ");
  }

  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }

  return `Request failed (HTTP ${status})`;
}

async function request(path, { method = "GET", body } = {}) {
  let response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach the API at ${BASE}. Is the backend running?`);
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = new Error(errorMessage(response.status, payload));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export const api = {
  listStudents: () => request("/students"),

  createStudent: (student) =>
    request("/students", {
      method: "POST",
      body: student,
    }),

  deleteStudent: (id) =>
    request(`/students/${id}`, {
      method: "DELETE",
    }),

  enroll: (studentId, images) =>
    request("/faces/enroll", {
      method: "POST",
      body: {
        student_id: studentId,
        images,
      },
    }),

  startSession: (className) =>
    request("/attendance/sessions", {
      method: "POST",
      body: {
        class_name: className,
      },
    }),

  recognize: (sessionId, image) =>
    request(`/attendance/sessions/${sessionId}/recognize`, {
      method: "POST",
      body: {
        image,
      },
    }),

  live: (sessionId) => request(`/attendance/sessions/${sessionId}/live`),

  attendanceHistory: ({ className, studentId, date } = {}) => {
    const params = new URLSearchParams();

    if (className) params.set("class_name", className);
    if (studentId) params.set("student_id", String(studentId));
    if (date) params.set("date", date);

    const query = params.toString();

    return request(`/attendance/history${query ? `?${query}` : ""}`);
  },

  attendanceAnalytics: ({ className, studentId } = {}) => {
    const params = new URLSearchParams();

    if (className) params.set("class_name", className);
    if (studentId) params.set("student_id", String(studentId));

    const query = params.toString();

    return request(`/attendance/analytics${query ? `?${query}` : ""}`);
  },
};

export { BASE as API_BASE };