"""Pydantic v2 request / response models."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


# --- students -------------------------------------------------------------------
class StudentCreate(BaseModel):
    roll_no: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    class_name: str = Field(min_length=1, max_length=100)


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    roll_no: str
    name: str
    class_name: str
    created_at: datetime


class StudentListItem(StudentOut):
    enrolled: bool
    encoding_count: int


# --- enrolment ------------------------------------------------------------------
class EnrollRequest(BaseModel):
    student_id: int
    images: list[str] = Field(min_length=1, description="data:image/jpeg;base64,... strings")


class EnrollSampleResult(BaseModel):
    index: int
    accepted: bool
    error: str | None = None
    detection_prob: float | None = None
    latency_ms: dict[str, float] | None = None


class EnrollResponse(BaseModel):
    student_id: int
    accepted: int
    rejected: int
    total_encodings: int
    results: list[EnrollSampleResult]


# --- attendance -----------------------------------------------------------------
class SessionCreate(BaseModel):
    class_name: str = Field(min_length=1, max_length=100)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_name: str
    date: date
    started_at: datetime
    ended_at: datetime | None


class RecognizeRequest(BaseModel):
    image: str = Field(description="data:image/jpeg;base64,... string")


class RecognizeResponse(BaseModel):
    matched: bool
    student: StudentOut | None = None
    confidence: float | None = None
    already_marked: bool = False
    # no_face | multiple_faces | low_detection_prob | unknown_face | no_encodings | matched
    reason: str
    latency_ms: dict[str, float]


class PresentEntry(BaseModel):
    student: StudentOut
    marked_at: datetime
    confidence: float


class LiveResponse(BaseModel):
    session: SessionOut
    present: list[PresentEntry]
    absent: list[StudentOut]
    present_count: int
    absent_count: int
# --- attendance history and analytics ------------------------------------------
class AttendanceHistoryEntry(BaseModel):
    session_id: int
    date: date
    class_name: str
    student: StudentOut
    status: str
    marked_at: datetime | None = None
    confidence: float | None = None


class AttendanceHistoryResponse(BaseModel):
    total_records: int
    present_count: int
    absent_count: int
    records: list[AttendanceHistoryEntry]


class AnalyticsSummary(BaseModel):
    total_sessions: int
    total_students: int
    total_possible_attendance: int
    total_present: int
    attendance_percentage: float


class ClassAnalyticsEntry(BaseModel):
    class_name: str
    total_students: int
    total_sessions: int
    total_present: int
    total_possible_attendance: int
    attendance_percentage: float


class StudentAnalyticsEntry(BaseModel):
    student: StudentOut
    total_sessions: int
    present_count: int
    absent_count: int
    attendance_percentage: float


class DailyAnalyticsEntry(BaseModel):
    date: date
    total_sessions: int
    total_present: int
    total_possible_attendance: int
    attendance_percentage: float


class AttendanceAnalyticsResponse(BaseModel):
    summary: AnalyticsSummary
    class_summary: list[ClassAnalyticsEntry]
    student_summary: list[StudentAnalyticsEntry]
    daily_summary: list[DailyAnalyticsEntry]