import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Students from "./pages/Students.jsx";
import Enroll from "./pages/Enroll.jsx";
import MarkAttendance from "./pages/MarkAttendance.jsx";
import AttendanceHistory from "./pages/AttendanceHistory.jsx";
import AttendanceAnalytics from "./pages/AttendanceAnalytics.jsx";

const links = [
  { to: "/students", label: "Students" },
  { to: "/enroll", label: "Enroll" },
  { to: "/attendance", label: "Mark Attendance" },
  { to: "/history", label: "History" },
  { to: "/analytics", label: "Analytics" },
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <span className="mr-3 text-base font-semibold tracking-tight">
            Face Attendance
          </span>

          <nav className="flex flex-wrap gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/students" replace />} />
          <Route path="/students" element={<Students />} />
          <Route path="/enroll" element={<Enroll />} />
          <Route path="/attendance" element={<MarkAttendance />} />
          <Route path="/history" element={<AttendanceHistory />} />
          <Route path="/analytics" element={<AttendanceAnalytics />} />
          <Route path="*" element={<Navigate to="/students" replace />} />
        </Routes>
      </main>
    </div>
  );
}