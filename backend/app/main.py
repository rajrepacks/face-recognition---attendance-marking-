"""FastAPI application entrypoint for the face attendance system."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database import SessionLocal, engine, init_models
from app.face.engine import FaceEngine
from app.models import FaceEncoding
from app.routers import attendance, faces, students

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_models()
    logger.info("database tables ready")

    # Weights are downloaded on first run (~110 MB) and then cached by torch.
    face_engine = await run_in_threadpool(
        FaceEngine,
        threshold=settings.face_match_threshold,
        min_detection_prob=settings.face_min_detection_prob,
        detection_floor=settings.face_detection_floor,
        image_size=settings.face_image_size,
        margin=settings.face_crop_margin,
        device="cpu",
    )
    app.state.face_engine = face_engine

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(FaceEncoding.student_id, FaceEncoding.vector).order_by(FaceEncoding.id)
            )
        ).all()
    await run_in_threadpool(face_engine.load_cache, [(sid, blob) for sid, blob in rows])
    logger.info("startup complete, match threshold=%.2f", settings.face_match_threshold)

    yield

    await engine.dispose()


app = FastAPI(
    title="Face Recognition Attendance System",
    description="Phase 1: register, enrol, recognise, mark attendance.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(students.router, prefix=settings.api_prefix)
app.include_router(faces.router, prefix=settings.api_prefix)
app.include_router(attendance.router, prefix=settings.api_prefix)
