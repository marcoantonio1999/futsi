from collections import defaultdict
from decimal import Decimal

from django.db.models import Prefetch, Sum

from .common import *


CONFIRMED_PAYMENT_STATUSES = {"registered", "reconciled"}
PENDING_PAYMENT_STATUSES = {"processing", "awaiting_confirmation"}
OPEN_CHARGE_STATUSES = {"pending", "partial"}


def _money(value) -> float:
    return float(value or Decimal("0"))


def _prefetched_charge_balance(charge: Charge) -> Decimal:
    paid = sum((payment.amount for payment in getattr(charge, "confirmed_payments", [])), Decimal("0"))
    discounted = sum((discount.amount for discount in getattr(charge, "approved_discounts", [])), Decimal("0"))
    return max((charge.amount or Decimal("0")) - paid - discounted, Decimal("0"))


def _month_key(value) -> str:
    if not value:
        return ""
    return value.strftime("%Y-%m")


def _month_label(month: str) -> str:
    labels = {
        "01": "Ene",
        "02": "Feb",
        "03": "Mar",
        "04": "Abr",
        "05": "May",
        "06": "Jun",
        "07": "Jul",
        "08": "Ago",
        "09": "Sep",
        "10": "Oct",
        "11": "Nov",
        "12": "Dic",
    }
    if not month or "-" not in month:
        return "Sin mes"
    return f"{labels.get(month[-2:], month[-2:])} {month[:4]}"


def _income_category(payment: Payment) -> str:
    text = f"{getattr(payment.charge, 'concept', '') if payment.charge_id else ''} {payment.notes or ''} {getattr(payment.team, 'name', '') if payment.team_id else ''}".lower()
    if "uniform" in text:
        return "Uniformes"
    if "arbit" in text:
        return "Arbitraje"
    if "renta" in text or "cancha" in text:
        return "Renta cancha"
    if "liga" in text or "jornada" in text or "torneo" in text or payment.team_id:
        return "Liga"
    if "curso" in text or "verano" in text or "intensivo" in text:
        return "Cursos"
    return "Mensualidades"


def _expense_category(expense: Expense) -> str:
    text = f"{expense.category} {expense.description}".lower()
    if "coach" in text:
        return "Nomina coaches"
    if "admin" in text:
        return "Nomina administrativa"
    if "arbit" in text:
        return "Arbitraje"
    if "renta" in text:
        return "Renta"
    if "material" in text or "deportivo" in text or "uniform" in text:
        return "Material deportivo"
    if "mantenimiento" in text or "limpieza" in text:
        return "Mantenimiento"
    if "publicidad" in text:
        return "Publicidad"
    if "servicio" in text or "luz" in text or "telefono" in text:
        return "Servicios"
    if "traslado" in text or "viatico" in text:
        return "Traslados"
    return "Otros"


def _scoped_sites(user):
    queryset = Site.objects.all()
    if user.role in {"cashier", "coach"} and user.primary_site_id:
        queryset = queryset.filter(id=user.primary_site_id)
    if user.role == "guardian":
        queryset = queryset.filter(students__guardian__user=user)
    return queryset.distinct()


def _scoped_students(user, site_ids):
    queryset = Student.objects.select_related("site").filter(site_id__in=site_ids)
    if user.role == "guardian":
        queryset = queryset.filter(guardian__user=user)
    if user.role == "coach" and user.coach_group_name:
        queryset = queryset.filter(group_name=user.coach_group_name)
    return queryset.distinct()


def _scoped_charges(user, site_ids):
    queryset = (
        Charge.objects.filter(site_id__in=site_ids)
        .prefetch_related(
            Prefetch(
                "payments",
                queryset=Payment.objects.filter(status__in=CONFIRMED_PAYMENT_STATUSES).only("id", "charge", "amount"),
                to_attr="confirmed_payments",
            ),
            Prefetch(
                "discounts",
                queryset=Discount.objects.filter(status="approved").only("id", "charge", "amount"),
                to_attr="approved_discounts",
            ),
        )
        .only("id", "site", "student", "team", "amount", "status")
    )
    if user.role == "guardian":
        queryset = queryset.filter(student__guardian__user=user)
    if user.role == "adult_representative":
        queryset = queryset.filter(team__representative_user=user)
    if user.role == "adult_player":
        queryset = queryset.filter(team__players__user=user)
    return queryset.distinct()


def _scoped_payments(user, site_ids):
    queryset = (
        Payment.objects.select_related("charge", "team")
        .filter(site_id__in=site_ids)
        .only(
            "id",
            "site",
            "charge",
            "student",
            "team",
            "method",
            "status",
            "amount",
            "paid_at",
            "confirmed_at",
            "notes",
            "charge__id",
            "charge__site",
            "charge__concept",
            "team__id",
            "team__name",
        )
    )
    if user.role == "guardian":
        queryset = queryset.filter(student__guardian__user=user)
    if user.role == "adult_representative":
        queryset = queryset.filter(team__representative_user=user)
    if user.role == "adult_player":
        queryset = queryset.filter(team__players__user=user)
    return queryset.distinct()


def _scoped_expenses(user, site_ids):
    queryset = Expense.objects.filter(site_id__in=site_ids).only("id", "site", "status", "amount", "expense_date", "category", "description")
    if user.role in {"cashier", "coach"} and user.primary_site_id:
        queryset = queryset.filter(site_id=user.primary_site_id)
    return queryset.distinct()


class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sites = list(_scoped_sites(request.user).order_by("name"))
        site_ids = [site.id for site in sites]
        students = list(_scoped_students(request.user, site_ids).only("id", "site_id", "full_name", "status"))
        charges = list(_scoped_charges(request.user, site_ids).filter(status__in=OPEN_CHARGE_STATUSES))
        payments = list(_scoped_payments(request.user, site_ids))
        expenses = list(_scoped_expenses(request.user, site_ids))
        discounts = list(Discount.objects.select_related("student").filter(site_id__in=site_ids, status="requested"))
        attendance_with_debt = list(
            AttendanceRecord.objects.select_related("student", "session")
            .filter(session__site_id__in=site_ids, status="present", had_debt_at_capture=True)
            .order_by("-created_at")[:5]
        )

        balance_by_student = defaultdict(Decimal)
        balance_by_site = defaultdict(Decimal)
        open_balance = Decimal("0")
        for charge in charges:
            balance = _prefetched_charge_balance(charge)
            if balance <= 0:
                continue
            open_balance += balance
            balance_by_site[charge.site_id] += balance
            if charge.student_id:
                balance_by_student[charge.student_id] += balance

        confirmed_payments = [payment for payment in payments if payment.status in CONFIRMED_PAYMENT_STATUSES]
        pending_payments = [payment for payment in payments if payment.status in PENDING_PAYMENT_STATUSES]
        approved_expenses = [expense for expense in expenses if expense.status == "approved"]
        pending_expenses = [expense for expense in expenses if expense.status == "pending"]

        total_income = sum((payment.amount for payment in confirmed_payments), Decimal("0"))
        pending_payment_total = sum((payment.amount for payment in pending_payments), Decimal("0"))
        approved_expense_total = sum((expense.amount for expense in approved_expenses), Decimal("0"))
        pending_expense_total = sum((expense.amount for expense in pending_expenses), Decimal("0"))

        payments_by_site = defaultdict(Decimal)
        payments_by_method = defaultdict(Decimal)
        monthly_income = defaultdict(Decimal)
        monthly_expense = defaultdict(Decimal)
        site_month_income = defaultdict(Decimal)
        site_month_expense = defaultdict(Decimal)
        category_rows = defaultdict(lambda: {"amount": Decimal("0"), "count": 0})
        payer_by_month = defaultdict(set)

        for payment in confirmed_payments:
            site_id = payment.site_id or (payment.charge.site_id if payment.charge_id and payment.charge else None)
            if not site_id:
                continue
            amount = payment.amount or Decimal("0")
            month = _month_key(payment.confirmed_at or payment.paid_at)
            payments_by_site[site_id] += amount
            payments_by_method[payment.method] += amount
            monthly_income[month] += amount
            site_month_income[(site_id, month)] += amount
            payer_key = f"student:{payment.student_id}" if payment.student_id else f"team:{payment.team_id}" if payment.team_id else f"charge:{payment.charge_id}" if payment.charge_id else f"payment:{payment.id}"
            payer_by_month[month].add(payer_key)
            category_key = ("all", month, "Ingreso", _income_category(payment))
            category_rows[category_key]["amount"] += amount
            category_rows[category_key]["count"] += 1
            site_category_key = (str(site_id), month, "Ingreso", _income_category(payment))
            category_rows[site_category_key]["amount"] += amount
            category_rows[site_category_key]["count"] += 1

        for expense in approved_expenses:
            amount = expense.amount or Decimal("0")
            month = _month_key(expense.expense_date)
            monthly_expense[month] += amount
            site_month_expense[(expense.site_id, month)] += amount
            category_key = ("all", month, "Egreso", _expense_category(expense))
            category_rows[category_key]["amount"] += amount
            category_rows[category_key]["count"] += 1
            site_category_key = (str(expense.site_id), month, "Egreso", _expense_category(expense))
            category_rows[site_category_key]["amount"] += amount
            category_rows[site_category_key]["count"] += 1

        expenses_by_site = defaultdict(Decimal)
        for expense in approved_expenses:
            expenses_by_site[expense.site_id] += expense.amount or Decimal("0")

        attendance_by_site = dict(
            AttendanceRecord.objects.filter(session__site_id__in=site_ids, status="present").values("session__site_id").annotate(total=Count("id")).values_list("session__site_id", "total")
        )
        students_by_site = defaultdict(int)
        student_status_counts = defaultdict(int)
        student_by_id = {}
        for student in students:
            students_by_site[student.site_id] += 1
            student_status_counts[student.status] += 1
            student_by_id[student.id] = student

        site_rows = []
        for site in sites:
            payments_total = payments_by_site[site.id]
            expenses_total = expenses_by_site[site.id]
            site_rows.append(
                {
                    "id": site.id,
                    "name": site.name,
                    "address": site.address,
                    "latitude": str(site.latitude) if site.latitude is not None else None,
                    "longitude": str(site.longitude) if site.longitude is not None else None,
                    "is_active": site.is_active,
                    "students": students_by_site[site.id],
                    "payments": _money(payments_total),
                    "expenses": _money(expenses_total),
                    "balance": _money(balance_by_site[site.id]),
                    "attendance": attendance_by_site.get(site.id, 0),
                    "utility": _money(payments_total - expenses_total),
                }
            )

        month_keys = sorted(set(monthly_income.keys()) | set(monthly_expense.keys()))
        current_month = timezone.localdate().strftime("%Y-%m")
        selected_month = current_month if current_month in month_keys else (month_keys[-1] if month_keys else "")
        selected_payer_count = len(payer_by_month[selected_month]) if selected_month else 0
        selected_month_total = monthly_income[selected_month] if selected_month else Decimal("0")

        monthly_rows = []
        for month in month_keys:
            income = monthly_income[month]
            expense = monthly_expense[month]
            monthly_rows.append({"site_id": "all", "site_name": "Todas", "month": month, "label": _month_label(month), "ingresos": _money(income), "egresos": _money(expense), "utilidad": _money(income - expense)})
            for site in sites:
                site_income = site_month_income[(site.id, month)]
                site_expense = site_month_expense[(site.id, month)]
                monthly_rows.append({"site_id": str(site.id), "site_name": site.name, "month": month, "label": _month_label(month), "ingresos": _money(site_income), "egresos": _money(site_expense), "utilidad": _money(site_income - site_expense)})

        alerts = []
        for student_id, balance in sorted(balance_by_student.items(), key=lambda item: item[1], reverse=True)[:5]:
            student = student_by_id.get(student_id)
            if not student:
                continue
            alerts.append({"id": f"debt-{student_id}", "title": f"{student.full_name} tiene cobro pendiente", "subtitle": f"{student.site.name if hasattr(student, 'site') else ''} - saldo ${_money(balance):,.2f}"})
        for discount in discounts[:5]:
            alerts.append({"id": f"discount-{discount.id}", "title": f"Descuento pendiente: {discount.student.full_name if discount.student_id else 'Sin alumno'}", "subtitle": f"{discount.reason} - ${_money(discount.amount):,.2f}"})
        for record in attendance_with_debt:
            alerts.append({"id": f"attendance-{record.id}", "title": f"{record.student.full_name if record.student_id else 'Alumno'} asistio con pago pendiente", "subtitle": record.override_reason or "Autorizacion registrada en cancha"})

        return Response(
            {
                "metrics": {
                    "active_sites": sum(1 for site in sites if site.is_active),
                    "students": len(students),
                    "pending_expenses": _money(pending_expense_total),
                    "open_balance": _money(open_balance),
                    "total_income": _money(total_income),
                    "approved_expenses": _money(approved_expense_total),
                    "utility": _money(total_income - approved_expense_total),
                    "pending_payment_total": _money(pending_payment_total),
                    "requested_discounts": len(discounts),
                    "students_with_debt": len(balance_by_student),
                    "attendance_with_debt": AttendanceRecord.objects.filter(session__site_id__in=site_ids, status="present", had_debt_at_capture=True).count(),
                    "ticket_average": {
                        "amount": _money(selected_month_total / selected_payer_count) if selected_payer_count else 0,
                        "total": _money(selected_month_total),
                        "payer_count": selected_payer_count,
                        "month_key": selected_month,
                        "month_label": _month_label(selected_month),
                    },
                },
                "site_rows": site_rows,
                "method_rows": [
                    {"label": "Efectivo", "value": _money(payments_by_method["cash"])},
                    {"label": "Transferencia", "value": _money(payments_by_method["transfer"])},
                    {"label": "Tarjeta", "value": _money(payments_by_method["card"])},
                    {"label": "Cortesia", "value": _money(payments_by_method["courtesy"])},
                ],
                "student_status_rows": [
                    {"label": "Activo", "value": student_status_counts["active"]},
                    {"label": "Prueba", "value": student_status_counts["trial"]},
                    {"label": "Pausa", "value": student_status_counts["paused"]},
                    {"label": "Lesion", "value": student_status_counts["injured"]},
                    {"label": "Baja", "value": student_status_counts["dropped"]},
                ],
                "payment_status_rows": [
                    {"label": "Confirmados", "value": _money(total_income)},
                    {"label": "En proceso", "value": _money(pending_payment_total)},
                    {"label": "Cobros pendientes", "value": _money(open_balance)},
                ],
                "monthly_rows": monthly_rows,
                "category_rows": [
                    {"site_id": site_id, "month": month, "type": row_type, "label": label, "amount": _money(payload["amount"]), "count": payload["count"]}
                    for (site_id, month, row_type, label), payload in category_rows.items()
                ],
                "alerts": alerts[:15],
            }
        )
