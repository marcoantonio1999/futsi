from django.test import TestCase
from rest_framework.test import APIClient

from core.models import Charge, CoachWorkLog, Expense, User


class SprintDemoFlowTests(TestCase):
    def setUp(self):
        from django.core.management import call_command

        call_command("seed_demo", verbosity=0)
        self.client = APIClient()
        response = self.client.post(
            "/api/auth/login/",
            {"username": "admin", "password": "admin12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")

    def test_demo_flow_crosses_attendance_billing_discounts_and_expenses(self):
        students = self.client.get("/api/students/").json()
        luis = next(student for student in students if student["full_name"] == "Luis Gomez")

        session_response = self.client.post(
            "/api/attendance-sessions/",
            {
                "site": luis["site"],
                "session_type": "academy_class",
                "date": "2026-05-26",
                "starts_at": "17:00",
                "group_name": luis["group_name"],
            },
            format="json",
        )
        self.assertEqual(session_response.status_code, 201)

        attendance_response = self.client.post(
            "/api/attendance-records/",
            {
                "session": session_response.json()["id"],
                "student": luis["id"],
                "status": "present",
            },
            format="json",
        )
        self.assertEqual(attendance_response.status_code, 201)
        self.assertTrue(attendance_response.json()["had_debt_at_capture"])

        charge = Charge.objects.get(student_id=luis["id"], concept="Mensualidad")
        payment_response = self.client.post(
            "/api/payments/",
            {
                "charge": charge.id,
                "method": "card",
                "amount": "500.00",
            },
            format="json",
        )
        self.assertEqual(payment_response.status_code, 201)
        charge.refresh_from_db()
        self.assertEqual(charge.status, "partial")

        discount_response = self.client.post(
            "/api/discounts/",
            {
                "charge": charge.id,
                "reason": "Autorizacion especial",
                "amount": "1000.00",
            },
            format="json",
        )
        self.assertEqual(discount_response.status_code, 201)

        approve_discount_response = self.client.post(f"/api/discounts/{discount_response.json()['id']}/approve/")
        self.assertEqual(approve_discount_response.status_code, 200)
        charge.refresh_from_db()
        self.assertEqual(charge.status, "paid")

        expense_response = self.client.post(
            "/api/expenses/",
            {
                "site": luis["site"],
                "category": "Arbitraje",
                "description": "Gasto de prueba",
                "amount": "300.00",
                "expense_date": "2026-05-26",
                "provider_name": "Proveedor test",
            },
            format="json",
        )
        self.assertEqual(expense_response.status_code, 201)

        approve_expense_response = self.client.post(f"/api/expenses/{expense_response.json()['id']}/approve/")
        self.assertEqual(approve_expense_response.status_code, 200)
        self.assertEqual(Expense.objects.get(id=expense_response.json()["id"]).approved_by, User.objects.get(username="admin"))

    def test_guardian_user_only_sees_their_students_and_cannot_create_charges(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"username": "padre.laura", "password": "familia12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["role"], "guardian")
        client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")

        students_response = client.get("/api/students/")
        self.assertEqual(students_response.status_code, 200)
        self.assertEqual(len(students_response.json()), 3)
        self.assertTrue(all(student["guardian_name"] == "Laura Martinez" for student in students_response.json()))

        forbidden_response = client.post(
            "/api/charges/",
            {
                "site": students_response.json()[0]["site"],
                "student": students_response.json()[0]["id"],
                "concept": "No permitido",
                "amount": "100.00",
            },
            format="json",
        )
        self.assertEqual(forbidden_response.status_code, 403)

    def test_guardian_can_update_profile_contact_data(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"username": "padre.jorge", "password": "familia12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")

        profile_response = client.patch(
            "/api/auth/me/",
            {
                "guardian_full_name": "Jorge Ramirez Actualizado",
                "guardian_email": "jorge.actualizado@example.com",
                "guardian_phone": "5510101010",
                "avatar_url": "https://example.com/avatar.jpg",
            },
            format="json",
        )
        self.assertEqual(profile_response.status_code, 200)
        self.assertEqual(profile_response.json()["guardian_name"], "Jorge Ramirez Actualizado")
        self.assertEqual(profile_response.json()["email"], "jorge.actualizado@example.com")
        self.assertEqual(profile_response.json()["phone"], "5510101010")
        self.assertEqual(profile_response.json()["avatar_url"], "https://example.com/avatar.jpg")

    def test_student_control_fields_are_editable(self):
        students = self.client.get("/api/students/").json()
        mateo = next(student for student in students if student["full_name"] == "Mateo Martinez")
        response = self.client.patch(
            f"/api/students/{mateo['id']}/",
            {
                "photo_url": "https://example.com/mateo.jpg",
                "waiver_url": "https://example.com/responsiva.pdf",
                "medical_notes": "Alergia a penicilina",
                "uniform_status": "delivered",
                "pause_start": "2026-06-01",
                "pause_end": "2026-06-15",
                "pause_reason": "Viaje autorizado",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["photo_url"], "https://example.com/mateo.jpg")
        self.assertEqual(body["waiver_url"], "https://example.com/responsiva.pdf")
        self.assertEqual(body["medical_notes"], "Alergia a penicilina")
        self.assertEqual(body["pause_reason"], "Viaje autorizado")

    def test_cashier_only_sees_site_scope_and_can_process_payments(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"username": "caja.roma", "password": "demo12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["role"], "cashier")
        client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")

        sites_response = client.get("/api/sites/")
        self.assertEqual(sites_response.status_code, 200)
        self.assertEqual([site["name"] for site in sites_response.json()], ["Roma"])

        students_response = client.get("/api/students/")
        self.assertEqual(students_response.status_code, 200)
        self.assertEqual(len(students_response.json()), 21)
        self.assertTrue(all(student["site_name"] == "Roma" for student in students_response.json()))

        forbidden_student_response = client.post(
            "/api/students/",
            {
                "site": students_response.json()[0]["site"],
                "guardian": students_response.json()[0]["guardian"],
                "full_name": "Alumno no permitido",
                "status": "trial",
            },
            format="json",
        )
        self.assertEqual(forbidden_student_response.status_code, 403)

        forbidden_charge_response = client.post(
            "/api/charges/",
            {
                "site": students_response.json()[0]["site"],
                "student": students_response.json()[0]["id"],
                "concept": "No permitido",
                "amount": "100.00",
            },
            format="json",
        )
        self.assertEqual(forbidden_charge_response.status_code, 403)

        roma_charge = Charge.objects.get(student__full_name="Carlos Ruiz")
        payment_response = client.post(
            "/api/payments/",
            {
                "charge": roma_charge.id,
                "method": "card",
                "amount": "100.00",
                "reference": "terminal-demo",
            },
            format="json",
        )
        self.assertEqual(payment_response.status_code, 201)
        self.assertEqual(payment_response.json()["received_by_username"], "caja.roma")

        coyoacan_charge = Charge.objects.get(student__full_name="Luis Gomez")
        cross_site_response = client.post(
            "/api/payments/",
            {
                "charge": coyoacan_charge.id,
                "method": "cash",
                "amount": "100.00",
            },
            format="json",
        )
        self.assertEqual(cross_site_response.status_code, 400)

    def test_payment_automation_simulation_flows(self):
        cashier = APIClient()
        response = cashier.post(
            "/api/auth/login/",
            {"username": "caja.roma", "password": "demo12345"},
            format="json",
        )
        cashier.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")
        roma_charge = Charge.objects.get(student__full_name="Carlos Ruiz")

        transfer_response = cashier.post(
            "/api/payments/",
            {
                "charge": roma_charge.id,
                "method": "transfer",
                "amount": "100.00",
            },
            format="json",
        )
        self.assertEqual(transfer_response.status_code, 201)
        self.assertEqual(transfer_response.json()["status"], "processing")
        roma_charge.refresh_from_db()
        self.assertEqual(roma_charge.status, "partial")

        webhook_response = cashier.post(f"/api/payments/{transfer_response.json()['id']}/simulate-webhook/")
        self.assertEqual(webhook_response.status_code, 200)
        self.assertEqual(webhook_response.json()["status"], "registered")

        cash_response = cashier.post(
            "/api/payments/",
            {
                "charge": roma_charge.id,
                "method": "cash",
                "amount": "50.00",
            },
            format="json",
        )
        self.assertEqual(cash_response.status_code, 201)
        self.assertEqual(cash_response.json()["status"], "awaiting_confirmation")

        guardian = APIClient()
        guardian_response = guardian.post(
            "/api/auth/login/",
            {"username": "padre.daniela", "password": "familia12345"},
            format="json",
        )
        guardian.credentials(HTTP_AUTHORIZATION=f"Token {guardian_response.json()['token']}")
        confirm_response = guardian.post(f"/api/payments/{cash_response.json()['id']}/confirm-cash/")
        self.assertEqual(confirm_response.status_code, 200)
        self.assertEqual(confirm_response.json()["status"], "registered")

    def test_coach_sees_only_assigned_group_and_can_register_attendance_and_hours(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"username": "coach.roma", "password": "demo12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["role"], "coach")
        client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")

        students_response = client.get("/api/students/")
        self.assertEqual(students_response.status_code, 200)
        students = students_response.json()
        self.assertEqual(len(students), 12)
        self.assertTrue(all(student["group_name"] == "Equipo Sub-12 A" for student in students))

        session_response = client.post(
            "/api/attendance-sessions/",
            {
                "site": students[0]["site"],
                "session_type": "academy_class",
                "date": "2026-05-26",
                "starts_at": "17:00",
                "group_name": "Equipo Sub-12 A",
            },
            format="json",
        )
        self.assertEqual(session_response.status_code, 201)

        attendance_response = client.post(
            "/api/attendance-records/",
            {
                "session": session_response.json()["id"],
                "student": students[0]["id"],
                "status": "present",
            },
            format="json",
        )
        self.assertEqual(attendance_response.status_code, 201)

        work_log_response = client.post(
            "/api/coach-work-logs/",
            {
                "work_date": "2026-05-26",
                "hours": "2.50",
                "activity": "Entrenamiento",
                "notes": "Prueba de coach",
            },
            format="json",
        )
        self.assertEqual(work_log_response.status_code, 201)
        self.assertEqual(CoachWorkLog.objects.get(id=work_log_response.json()["id"]).coach.username, "coach.roma")

        forbidden_expense_response = client.post(
            "/api/expenses/",
            {
                "site": students[0]["site"],
                "category": "Pago a coaches",
                "description": "No permitido",
                "amount": "300.00",
                "expense_date": "2026-05-26",
            },
            format="json",
        )
        self.assertEqual(forbidden_expense_response.status_code, 403)
