import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Students from "./pages/Students.jsx";
import Enroll from "./pages/Enroll.jsx";
import MarkAttendance from "./pages/MarkAttendance.jsx";

const links = [
  { to: "/students", label: "Students" },
  { to: "/enroll", label: "Enroll" },
  { to: "/attendance", label: "Mark Attendance" },
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <span className="text-base font-semibold tracking-tight">Face Attendance</span>
          <nav className="flex gap-1">
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
          <Route path="*" element={<Navigate to="/students" replace />} />
        </Routes>
      </main>
    </div>
  );
}
