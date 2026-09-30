"""Attendance sessions, live recognition and the present/absent list."""

import logging
import time
from collections import defaultdict
from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.database import get_session
from app.face.engine import FaceEngine, FaceError, decode_data_url
from app.models import AttendanceRecord, AttendanceSession, Student

from app.schemas import (
    AnalyticsSummary,
    AttendanceAnalyticsResponse,
    AttendanceHistoryEntry,
    AttendanceHistoryResponse,
    ClassAnalyticsEntry,
    DailyAnalyticsEntry,
    LiveResponse,
    PresentEntry,
    RecognizeRequest,
    RecognizeResponse,
    SessionCreate,
    SessionOut,
    StudentAnalyticsEntry,
    StudentOut,
)

logger = logging.getLogger("routers.attendance")

router = APIRouter(prefix="/attendance", tags=["attendance"])


async def _get_session_or_404(session_id: int, session: AsyncSession) -> AttendanceSession:
    attendance_session = await session.get(AttendanceSession, session_id)
    if attendance_session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance session {} does not exist.".format(session_id),
        )
    return attendance_session


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_200_OK)
async def create_or_get_session(
    payload: SessionCreate,
    session: AsyncSession = Depends(get_session),
) -> AttendanceSession:
    """Return today's still-open session for the class, creating one if needed."""
    class_name = payload.class_name.strip()
    today = date_cls.today()

    existing = await session.scalar(
        select(AttendanceSession)
        .where(
            AttendanceSession.class_name == class_name,
            AttendanceSession.date == today,
            AttendanceSession.ended_at.is_(None),
        )
        .order_by(AttendanceSession.started_at.desc())
        .limit(1)
    )
    if existing is not None:
        return existing

    attendance_session = AttendanceSession(class_name=class_name, date=today)
    session.add(attendance_session)
    await session.commit()
    await session.refresh(attendance_session)
    logger.info("session opened id=%s class=%s date=%s", attendance_session.id, class_name, today)
    return attendance_session


def _embed(engine: FaceEngine, data_url: str):
    image = decode_data_url(data_url)
    return engine.extract_embedding(image)


@router.post("/sessions/{session_id}/recognize", response_model=RecognizeResponse)
async def recognize(
    session_id: int,
    payload: RecognizeRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> RecognizeResponse:
    engine: FaceEngine = request.app.state.face_engine
    attendance_session = await _get_session_or_404(session_id, session)

    started = time.perf_counter()
    try:
        embedding = await run_in_threadpool(_embed, engine, payload.image)
    except FaceError as exc:
        total_ms = round((time.perf_counter() - started) * 1000.0, 2)
        return RecognizeResponse(
            matched=False,
            reason=exc.code,
            latency_ms={"total": total_ms},
        )

    if engine.cache_size == 0:
        total_ms = round((time.perf_counter() - started) * 1000.0, 2)
        return RecognizeResponse(
            matched=False,
            reason="no_encodings",
            latency_ms={**embedding.latency_ms, "match": 0.0, "total": total_ms},
        )

    match = await run_in_threadpool(engine.match, embedding.vector)
    latency = {
        **embedding.latency_ms,
        "match": round(match.match_ms, 2),
        "total": round((time.perf_counter() - started) * 1000.0, 2),
    }

    if match.student_id is None:
        return RecognizeResponse(
            matched=False,
            confidence=round(match.confidence, 4),
            reason="unknown_face",
            latency_ms=latency,
        )

    student = await session.get(Student, match.student_id)
    if student is None:  # encoding for a deleted student, treat as unknown
        return RecognizeResponse(
            matched=False,
            confidence=round(match.confidence, 4),
            reason="unknown_face",
            latency_ms=latency,
        )

    existing_record = await session.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == attendance_session.id,
            AttendanceRecord.student_id == student.id,
        )
    )
    already_marked = existing_record is not None

    if not already_marked:
        record = AttendanceRecord(
            session_id=attendance_session.id,
            student_id=student.id,
            confidence=float(match.confidence),
        )
        session.add(record)
        try:
            await session.commit()
        except IntegrityError:  # concurrent frame marked the same student first
            await session.rollback()
            already_marked = True
        else:
            logger.info(
                "marked student_id=%s session_id=%s confidence=%.4f total=%.1fms",
                student.id,
                attendance_session.id,
                match.confidence,
                latency["total"],
            )

    return RecognizeResponse(
        matched=True,
        student=StudentOut.model_validate(student),
        confidence=round(match.confidence, 4),
        already_marked=already_marked,
        reason="matched",
        latency_ms=latency,
    )


@router.get("/sessions/{session_id}/live", response_model=LiveResponse)
async def live(
    session_id: int,
    session: AsyncSession = Depends(get_session),
) -> LiveResponse:
    attendance_session = await _get_session_or_404(session_id, session)

    rows = (
        await session.execute(
            select(AttendanceRecord, Student)
            .join(Student, Student.id == AttendanceRecord.student_id)
            .where(AttendanceRecord.session_id == attendance_session.id)
            .order_by(AttendanceRecord.marked_at.desc())
        )
    ).all()

    present = [
        PresentEntry(
            student=StudentOut.model_validate(student),
            marked_at=record.marked_at,
            confidence=record.confidence,
        )
        for record, student in rows
    ]
    present_ids = {entry.student.id for entry in present}

    roster = (
        await session.scalars(
            select(Student)
            .where(Student.class_name == attendance_session.class_name)
            .order_by(Student.roll_no)
        )
    ).all()
    absent = [
        StudentOut.model_validate(student) for student in roster if student.id not in present_ids
    ]

    return LiveResponse(
        session=SessionOut.model_validate(attendance_session),
        present=present,
        absent=absent,
        present_count=len(present),
        absent_count=len(absent),
    )
@router.get("/history", response_model=AttendanceHistoryResponse)
async def attendance_history(
    class_name: str | None = None,
    student_id: int | None = None,
    date: date_cls | None = None,
    session: AsyncSession = Depends(get_session),
) -> AttendanceHistoryResponse:
    """
    Return a present/absent attendance history.

    Filtering options:
    - class_name: show one class only
    - student_id: show one student only
    - date: show one attendance date only
    """

    sessions_statement = select(AttendanceSession).order_by(
        AttendanceSession.date.desc(),
        AttendanceSession.started_at.desc(),
    )

    if class_name:
        sessions_statement = sessions_statement.where(
            AttendanceSession.class_name == class_name
        )

    if date:
        sessions_statement = sessions_statement.where(AttendanceSession.date == date)

    attendance_sessions = (await session.scalars(sessions_statement)).all()

    if not attendance_sessions:
        return AttendanceHistoryResponse(
            total_records=0,
            present_count=0,
            absent_count=0,
            records=[],
        )

    session_ids = [attendance_session.id for attendance_session in attendance_sessions]

    records_rows = (
        await session.execute(
            select(AttendanceRecord, Student)
            .join(Student, Student.id == AttendanceRecord.student_id)
            .where(AttendanceRecord.session_id.in_(session_ids))
        )
    ).all()

    records_by_session_and_student = {
        (record.session_id, record.student_id): record
        for record, _student in records_rows
    }

    class_names = {attendance_session.class_name for attendance_session in attendance_sessions}

    students_statement = (
        select(Student)
        .where(Student.class_name.in_(class_names))
        .order_by(Student.class_name, Student.roll_no)
    )

    if student_id:
        students_statement = students_statement.where(Student.id == student_id)

    students = (await session.scalars(students_statement)).all()

    students_by_class: dict[str, list[Student]] = defaultdict(list)

    for student in students:
        students_by_class[student.class_name].append(student)

    history_records: list[AttendanceHistoryEntry] = []

    for attendance_session in attendance_sessions:
        roster = students_by_class.get(attendance_session.class_name, [])

        for student in roster:
            record = records_by_session_and_student.get(
                (attendance_session.id, student.id)
            )

            history_records.append(
                AttendanceHistoryEntry(
                    session_id=attendance_session.id,
                    date=attendance_session.date,
                    class_name=attendance_session.class_name,
                    student=StudentOut.model_validate(student),
                    status="present" if record else "absent",
                    marked_at=record.marked_at if record else None,
                    confidence=record.confidence if record else None,
                )
            )

    present_count = sum(
        1 for item in history_records if item.status == "present"
    )
    absent_count = len(history_records) - present_count

    return AttendanceHistoryResponse(
        total_records=len(history_records),
        present_count=present_count,
        absent_count=absent_count,
        records=history_records,
    )


@router.get("/analytics", response_model=AttendanceAnalyticsResponse)
async def attendance_analytics(
    class_name: str | None = None,
    student_id: int | None = None,
    session: AsyncSession = Depends(get_session),
) -> AttendanceAnalyticsResponse:
    """
    Return calculated analytics from existing attendance sessions and records.

    Filters:
    - class_name: restrict results to one class
    - student_id: restrict student-level totals to one student
    """

    sessions_statement = select(AttendanceSession).order_by(
        AttendanceSession.date.asc(),
        AttendanceSession.started_at.asc(),
    )

    if class_name:
        sessions_statement = sessions_statement.where(
            AttendanceSession.class_name == class_name
        )

    attendance_sessions = (await session.scalars(sessions_statement)).all()

    if not attendance_sessions:
        empty_summary = AnalyticsSummary(
            total_sessions=0,
            total_students=0,
            total_possible_attendance=0,
            total_present=0,
            attendance_percentage=0.0,
        )

        return AttendanceAnalyticsResponse(
            summary=empty_summary,
            class_summary=[],
            student_summary=[],
            daily_summary=[],
        )

    session_ids = [attendance_session.id for attendance_session in attendance_sessions]
    class_names = {attendance_session.class_name for attendance_session in attendance_sessions}

    students_statement = (
        select(Student)
        .where(Student.class_name.in_(class_names))
        .order_by(Student.class_name, Student.roll_no)
    )

    if student_id:
        students_statement = students_statement.where(Student.id == student_id)

    students = (await session.scalars(students_statement)).all()

    selected_student_ids = {student.id for student in students}

    records_statement = select(AttendanceRecord).where(
        AttendanceRecord.session_id.in_(session_ids)
    )

    if student_id:
        records_statement = records_statement.where(
            AttendanceRecord.student_id == student_id
        )

    attendance_records = (await session.scalars(records_statement)).all()

    sessions_by_id = {
        attendance_session.id: attendance_session
        for attendance_session in attendance_sessions
    }

    students_by_class: dict[str, list[Student]] = defaultdict(list)

    for student in students:
        students_by_class[student.class_name].append(student)

    session_count_by_class: dict[str, int] = defaultdict(int)

    for attendance_session in attendance_sessions:
        session_count_by_class[attendance_session.class_name] += 1

    present_count_by_student: dict[int, int] = defaultdict(int)

    for record in attendance_records:
        if record.student_id in selected_student_ids:
            present_count_by_student[record.student_id] += 1

    class_summary: list[ClassAnalyticsEntry] = []

    for current_class in sorted(class_names):
        class_students = students_by_class.get(current_class, [])
        total_sessions = session_count_by_class[current_class]
        total_students = len(class_students)
        total_possible_attendance = total_sessions * total_students

        total_present = sum(
            present_count_by_student[student.id]
            for student in class_students
        )

        attendance_percentage = (
            round((total_present / total_possible_attendance) * 100, 2)
            if total_possible_attendance
            else 0.0
        )

        class_summary.append(
            ClassAnalyticsEntry(
                class_name=current_class,
                total_students=total_students,
                total_sessions=total_sessions,
                total_present=total_present,
                total_possible_attendance=total_possible_attendance,
                attendance_percentage=attendance_percentage,
            )
        )

    student_summary: list[StudentAnalyticsEntry] = []

    for student in students:
        total_sessions = session_count_by_class[student.class_name]
        present_count = present_count_by_student[student.id]
        absent_count = max(total_sessions - present_count, 0)

        attendance_percentage = (
            round((present_count / total_sessions) * 100, 2)
            if total_sessions
            else 0.0
        )

        student_summary.append(
            StudentAnalyticsEntry(
                student=StudentOut.model_validate(student),
                total_sessions=total_sessions,
                present_count=present_count,
                absent_count=absent_count,
                attendance_percentage=attendance_percentage,
            )
        )

    student_summary.sort(
        key=lambda item: (
            item.attendance_percentage,
            item.student.class_name,
            item.student.roll_no,
        )
    )

    sessions_by_date: dict[date_cls, list[AttendanceSession]] = defaultdict(list)

    for attendance_session in attendance_sessions:
        sessions_by_date[attendance_session.date].append(attendance_session)

    present_count_by_date: dict[date_cls, int] = defaultdict(int)

    for record in attendance_records:
        attendance_session = sessions_by_id.get(record.session_id)

        if attendance_session and record.student_id in selected_student_ids:
            present_count_by_date[attendance_session.date] += 1

    daily_summary: list[DailyAnalyticsEntry] = []

    for current_date in sorted(sessions_by_date):
        sessions_for_day = sessions_by_date[current_date]

        total_possible_attendance = sum(
            len(students_by_class.get(attendance_session.class_name, []))
            for attendance_session in sessions_for_day
        )

        total_present = present_count_by_date[current_date]

        attendance_percentage = (
            round((total_present / total_possible_attendance) * 100, 2)
            if total_possible_attendance
            else 0.0
        )

        daily_summary.append(
            DailyAnalyticsEntry(
                date=current_date,
                total_sessions=len(sessions_for_day),
                total_present=total_present,
                total_possible_attendance=total_possible_attendance,
                attendance_percentage=attendance_percentage,
            )
        )

    total_possible_attendance = sum(
        item.total_possible_attendance for item in class_summary
    )
    total_present = sum(item.total_present for item in class_summary)

    summary = AnalyticsSummary(
        total_sessions=len(attendance_sessions),
        total_students=len(students),
        total_possible_attendance=total_possible_attendance,
        total_present=total_present,
        attendance_percentage=(
            round((total_present / total_possible_attendance) * 100, 2)
            if total_possible_attendance
            else 0.0
        ),
    )

    return AttendanceAnalyticsResponse(
        summary=summary,
        class_summary=class_summary,
        student_summary=student_summary,
        daily_summary=daily_summary,
    )