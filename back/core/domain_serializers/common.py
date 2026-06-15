from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from core.models import (
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    CashMovement,
    Charge,
    CoachWorkLog,
    Court,
    DailyClosure,
    Discount,
    Expense,
    FaceRecognitionAttempt,
    Guardian,
    HistoricalImport,
    HistoricalImportRow,
    Invoice,
    Match,
    Payment,
    Player,
    PlayerAttendanceRecord,
    Round,
    Site,
    StaffPaymentRequest,
    Student,
    StudentAssessment,
    StudentTournamentRegistration,
    Team,
    Tournament,
    User,
)


