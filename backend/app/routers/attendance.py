"""Attendance sessions, live recognition and the present/absent list."""

import logging
import time
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
    LiveResponse,
    PresentEntry,
    RecognizeRequest,
    RecognizeResponse,
    SessionCreate,
    SessionOut,
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
