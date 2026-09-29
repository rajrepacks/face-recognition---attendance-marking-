"""Face enrolment: turn captured samples into stored 512-d encodings."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.database import get_session
from app.face.engine import FaceEngine, FaceError, decode_data_url
from app.models import FaceEncoding, Student
from app.schemas import EnrollRequest, EnrollResponse, EnrollSampleResult

logger = logging.getLogger("routers.faces")

router = APIRouter(prefix="/faces", tags=["faces"])


async def refresh_encoding_cache(engine: FaceEngine, session: AsyncSession) -> int:
    """Reload the in-memory (N, 512) matrix from the database."""
    rows = (
        await session.execute(
            select(FaceEncoding.student_id, FaceEncoding.vector).order_by(FaceEncoding.id)
        )
    ).all()
    return await run_in_threadpool(engine.load_cache, [(sid, blob) for sid, blob in rows])


def _process_sample(engine: FaceEngine, data_url: str):
    image = decode_data_url(data_url)
    return engine.extract_embedding(image)


@router.post("/enroll", response_model=EnrollResponse)
async def enroll_faces(
    payload: EnrollRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> EnrollResponse:
    engine: FaceEngine = request.app.state.face_engine

    student = await session.get(Student, payload.student_id)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student {} does not exist.".format(payload.student_id),
        )

    results: list[EnrollSampleResult] = []
    accepted_vectors: list[bytes] = []
    first_error: FaceError | None = None

    for index, data_url in enumerate(payload.images):
        try:
            embedding = await run_in_threadpool(_process_sample, engine, data_url)
        except FaceError as exc:
            if first_error is None:
                first_error = exc
            results.append(
                EnrollSampleResult(
                    index=index,
                    accepted=False,
                    error=exc.message,
                    detection_prob=exc.detection_prob,
                )
            )
            continue

        # ----------------------------------------------------------------
        # DUPLICATE FACE CHECK
        # Before accepting this sample, check if the face already matches
        # an EXISTING student in the cache (other than the current student).
        # ----------------------------------------------------------------
        match_result = await run_in_threadpool(engine.match, embedding.vector)
        if (
            match_result.student_id is not None
            and match_result.student_id != payload.student_id
        ):
            # Find the name of the already-enrolled student for a clear message
            existing_student = await session.get(Student, match_result.student_id)
            existing_name = existing_student.name if existing_student else str(match_result.student_id)
            error_msg = (
                "This face is already registered to another student: {} (ID {}). "
                "Each student must have a unique face.".format(
                    existing_name, match_result.student_id
                )
            )
            logger.warning(
                "enroll duplicate_face: student_id=%s conflicts with existing student_id=%s score=%.4f",
                payload.student_id,
                match_result.student_id,
                match_result.confidence,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "face_already_registered",
                    "message": error_msg,
                    "conflicting_student_id": match_result.student_id,
                },
            )
        # ----------------------------------------------------------------

        accepted_vectors.append(embedding.vector.tobytes())
        results.append(
            EnrollSampleResult(
                index=index,
                accepted=True,
                detection_prob=round(embedding.detection_prob, 4),
                latency_ms=embedding.latency_ms,
            )
        )

    if not accepted_vectors:
        assert first_error is not None
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": first_error.code,
                "message": first_error.message,
                "results": [r.model_dump() for r in results],
            },
        )

    session.add_all(
        FaceEncoding(student_id=student.id, vector=blob) for blob in accepted_vectors
    )
    await session.commit()

    total = await session.scalar(
        select(func.count(FaceEncoding.id)).where(FaceEncoding.student_id == student.id)
    )
    cached = await refresh_encoding_cache(engine, session)
    logger.info(
        "enrolled student_id=%s accepted=%d rejected=%d cache=%d",
        student.id,
        len(accepted_vectors),
        len(results) - len(accepted_vectors),
        cached,
    )

    return EnrollResponse(
        student_id=student.id,
        accepted=len(accepted_vectors),
        rejected=len(results) - len(accepted_vectors),
        total_encodings=int(total or 0),
        results=results,
    )