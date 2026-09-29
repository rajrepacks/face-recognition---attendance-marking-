"""Student registration and listing."""

from fastapi import APIRouter, Depends, HTTPException,Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import FaceEncoding, Student
from app.schemas import StudentCreate, StudentListItem, StudentOut

router = APIRouter(prefix="/students", tags=["students"])


@router.post("", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
async def create_student(
    payload: StudentCreate,
    session: AsyncSession = Depends(get_session),
) -> Student:
    roll_no = payload.roll_no.strip()
    existing = await session.scalar(select(Student).where(Student.roll_no == roll_no))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Roll number {} is already registered.".format(roll_no),
        )

    student = Student(
        roll_no=roll_no,
        name=payload.name.strip(),
        class_name=payload.class_name.strip(),
    )
    session.add(student)
    await session.commit()
    await session.refresh(student)
    return student


@router.get("", response_model=list[StudentListItem])
async def list_students(
    session: AsyncSession = Depends(get_session),
) -> list[StudentListItem]:
    stmt = (
        select(Student, func.count(FaceEncoding.id).label("encoding_count"))
        .outerjoin(FaceEncoding, FaceEncoding.student_id == Student.id)
        .group_by(Student.id)
        .order_by(Student.class_name, Student.roll_no)
    )
    rows = (await session.execute(stmt)).all()
    return [
        StudentListItem(
            **StudentOut.model_validate(student).model_dump(),
            enrolled=encoding_count > 0,
            encoding_count=encoding_count,
        )
        for student, encoding_count in rows

    ]
@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(
    student_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> None:
    from fastapi import Request
    from app.routers.faces import refresh_encoding_cache

    student = await session.get(Student, student_id)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student {} does not exist.".format(student_id),
        )
    await session.delete(student)
    await session.commit()

    # Refresh the in-memory face cache so deleted student is no longer matched
    engine = request.app.state.face_engine
    await refresh_encoding_cache(engine, session)