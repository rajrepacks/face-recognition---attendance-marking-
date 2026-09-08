"""MTCNN detection + FaceNet (InceptionResnetV1/vggface2) embedding engine.

The models are heavy, so a single instance is built at application startup and
kept on ``app.state.face_engine``. Known encodings are held in memory as one
(N, 512) float32 matrix so a match is a single matrix multiply instead of a loop.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
import torch
from facenet_pytorch import MTCNN, InceptionResnetV1, extract_face
from PIL import Image

logger = logging.getLogger("face.engine")

EMBEDDING_DIM = 512
_DATA_URL_RE = re.compile(r"^data:image/[a-zA-Z0-9.+-]+;base64,", re.IGNORECASE)


# --- errors ---------------------------------------------------------------------
class FaceError(Exception):
    """Base class for recoverable face pipeline errors."""

    code = "face_error"
    message = "Face processing failed."

    def __init__(self, message: str | None = None, detection_prob: float | None = None):
        self.message = message or self.message
        self.detection_prob = detection_prob
        super().__init__(self.message)


class InvalidImageError(FaceError):
    code = "invalid_image"
    message = "Image could not be decoded."


class NoFaceError(FaceError):
    code = "no_face"
    message = "No face detected. Move into frame and make sure the room is well lit."


class MultipleFacesError(FaceError):
    code = "multiple_faces"
    message = "More than one face detected. Only one person may be in frame."


class LowDetectionProbError(FaceError):
    code = "low_detection_prob"
    message = "Face detected but confidence is too low. Move closer and hold still."


# --- results --------------------------------------------------------------------
@dataclass
class EmbeddingResult:
    vector: np.ndarray  # (512,) float32, L2 normalised
    bbox: list[float]  # [x1, y1, x2, y2]
    detection_prob: float
    latency_ms: dict[str, float] = field(default_factory=dict)


@dataclass
class MatchResult:
    student_id: int | None
    confidence: float  # best cosine similarity seen, even when below threshold
    match_ms: float


def decode_data_url(data_url: str) -> np.ndarray:
    """Decode a browser data URL (data:image/jpeg;base64,...) into a BGR ndarray."""
    if not isinstance(data_url, str) or not data_url:
        raise InvalidImageError("Empty image payload.")

    payload = _DATA_URL_RE.sub("", data_url.strip(), count=1)
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:  # pragma: no cover - defensive
        raise InvalidImageError("Image is not valid base64: {}".format(exc)) from exc

    if not raw:
        raise InvalidImageError("Empty image payload.")

    buffer = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise InvalidImageError("Image bytes could not be decoded as an image.")
    return image


class FaceEngine:
    def __init__(
        self,
        *,
        threshold: float,
        min_detection_prob: float,
        detection_floor: float,
        image_size: int = 160,
        margin: int = 14,
        device: str = "cpu",
    ) -> None:
        self.threshold = threshold
        self.min_detection_prob = min_detection_prob
        self.detection_floor = detection_floor
        self.image_size = image_size
        self.margin = margin
        self.device = torch.device(device)

        logger.info("loading MTCNN + InceptionResnetV1(vggface2) on %s", device)
        self.mtcnn = MTCNN(
            image_size=image_size,
            margin=margin,
            keep_all=True,
            post_process=True,
            device=self.device,
        ).eval()
        self.resnet = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)

        self._lock = threading.Lock()
        # (matrix (N, 512) float32 with L2 normalised rows, student_id per row)
        self._cache: tuple[np.ndarray, list[int]] = (
            np.zeros((0, EMBEDDING_DIM), dtype=np.float32),
            [],
        )
        logger.info("face models ready")

    # --- encoding cache ---------------------------------------------------------
    def load_cache(self, rows: list[tuple[int, bytes]]) -> int:
        """Replace the in-memory encoding cache. rows is a list of (student_id, blob)."""
        vectors: list[np.ndarray] = []
        student_ids: list[int] = []
        for student_id, blob in rows:
            vec = np.frombuffer(blob, dtype=np.float32)
            if vec.size != EMBEDDING_DIM:
                logger.warning(
                    "skipping encoding for student %s: expected %d floats, got %d",
                    student_id,
                    EMBEDDING_DIM,
                    vec.size,
                )
                continue
            vectors.append(self._l2_normalize(vec.astype(np.float32, copy=True)))
            student_ids.append(student_id)

        matrix = (
            np.vstack(vectors).astype(np.float32)
            if vectors
            else np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
        )
        with self._lock:
            self._cache = (matrix, student_ids)
        logger.info(
            "encoding cache loaded: %d vectors / %d students",
            matrix.shape[0],
            len(set(student_ids)),
        )
        return matrix.shape[0]

    @property
    def cache_size(self) -> int:
        with self._lock:
            return self._cache[0].shape[0]

    # --- pipeline ---------------------------------------------------------------
    def extract_embedding(self, image_bgr: np.ndarray) -> EmbeddingResult:
        """Detect exactly one face and return its L2 normalised 512-d embedding."""
        pil_image = Image.fromarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))

        t0 = time.perf_counter()
        with torch.no_grad():
            boxes, probs = self.mtcnn.detect(pil_image)
        detect_ms = (time.perf_counter() - t0) * 1000.0

        candidates: list[tuple[np.ndarray, float]] = []
        if boxes is not None:
            for box, prob in zip(boxes, probs):
                if prob is None:
                    continue
                if float(prob) >= self.detection_floor:
                    candidates.append((box, float(prob)))

        if not candidates:
            logger.info("detect=%.1fms result=no_face", detect_ms)
            raise NoFaceError()
        if len(candidates) > 1:
            logger.info("detect=%.1fms result=multiple_faces n=%d", detect_ms, len(candidates))
            raise MultipleFacesError(
                "{} faces detected. Only one person may be in frame.".format(len(candidates))
            )

        box, prob = candidates[0]
        if prob < self.min_detection_prob:
            logger.info("detect=%.1fms result=low_detection_prob prob=%.3f", detect_ms, prob)
            raise LowDetectionProbError(
                "Face confidence {:.2f} is below the required {:.2f}. "
                "Move closer, hold still and improve the lighting.".format(
                    prob, self.min_detection_prob
                ),
                detection_prob=prob,
            )

        t1 = time.perf_counter()
        face = extract_face(pil_image, box, image_size=self.image_size, margin=self.margin)
        # InceptionResnetV1 expects the same standardisation MTCNN applies internally.
        face = (face - 127.5) / 128.0
        with torch.no_grad():
            embedding = self.resnet(face.unsqueeze(0).to(self.device))
        vector = self._l2_normalize(embedding[0].cpu().numpy().astype(np.float32))
        embed_ms = (time.perf_counter() - t1) * 1000.0

        logger.info("detect=%.1fms embed=%.1fms prob=%.3f", detect_ms, embed_ms, prob)
        return EmbeddingResult(
            vector=vector,
            bbox=[float(v) for v in box],
            detection_prob=prob,
            latency_ms={"detect": round(detect_ms, 2), "embed": round(embed_ms, 2)},
        )

    def match(self, vector: np.ndarray) -> MatchResult:
        """Cosine match against every cached encoding with a single matmul."""
        t0 = time.perf_counter()
        with self._lock:
            matrix, student_ids = self._cache

        if matrix.shape[0] == 0:
            return MatchResult(None, 0.0, (time.perf_counter() - t0) * 1000.0)

        scores = matrix @ vector.astype(np.float32)  # rows are L2 normalised -> cosine
        best_index = int(np.argmax(scores))
        best_score = float(scores[best_index])
        match_ms = (time.perf_counter() - t0) * 1000.0

        student_id = student_ids[best_index] if best_score >= self.threshold else None
        logger.info(
            "match=%.2fms best=%.4f threshold=%.2f student_id=%s",
            match_ms,
            best_score,
            self.threshold,
            student_id,
        )
        return MatchResult(student_id, best_score, match_ms)

    @staticmethod
    def _l2_normalize(vector: np.ndarray) -> np.ndarray:
        norm = float(np.linalg.norm(vector))
        if norm == 0.0:
            return vector
        return (vector / norm).astype(np.float32)
