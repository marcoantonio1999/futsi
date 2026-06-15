import base64
import os
import tempfile
import unicodedata
from calendar import monthrange
from datetime import date, datetime, time
from decimal import Decimal
from io import BytesIO
from urllib.request import urlretrieve
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db.models import Count
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image, ImageOps

from core.permissions import (
    IsAdminForWrites,
    IsAdminRole,
    IsOperationsCashierOrGuardianRole,
    IsOperationsCashierOrCoachRole,
    IsOperationsCashierCoachOrGuardianRole,
    IsOperationsCoachOrGuardianRole,
    IsOperationsOrCoachRole,
    IsOperationsOrCashierRole,
    IsOperationsOrGuardianRole,
    IsOperationsRole,
)
from core.models import (
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    CashMovement,
    CashMovementType,
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
from core.serializers import (
    AttendanceRecordSerializer,
    AttendanceSessionSerializer,
    AuditLogSerializer,
    CashMovementSerializer,
    ChargeSerializer,
    CoachWorkLogSerializer,
    CourtSerializer,
    DailyClosureSerializer,
    DiscountSerializer,
    ExpenseSerializer,
    FaceRecognitionAttemptSerializer,
    GuardianSerializer,
    HistoricalImportSerializer,
    InvoiceSerializer,
    MatchSerializer,
    PaymentSerializer,
    PlayerAttendanceRecordSerializer,
    PlayerSerializer,
    RoundSerializer,
    SiteSerializer,
    StaffPaymentRequestSerializer,
    StudentSerializer,
    StudentAssessmentSerializer,
    StudentTournamentRegistrationSerializer,
    TeamSerializer,
    TournamentSerializer,
    UserSerializer,
    charge_balance,
    sync_charge_status,
)
