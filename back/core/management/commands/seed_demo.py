from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import (
    AttendanceRecord,
    AttendanceSession,
    Charge,
    CoachWorkLog,
    DailyClosure,
    Discount,
    Expense,
    Guardian,
    Payment,
    Site,
    Student,
    User,
)


class Command(BaseCommand):
    help = "Carga datos demo reproducibles para Sprint 1."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Elimina datos operativos demo antes de volver a cargarlos.",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            CoachWorkLog.objects.all().delete()
            AttendanceRecord.objects.all().delete()
            AttendanceSession.objects.all().delete()
            Payment.objects.all().delete()
            Discount.objects.all().delete()
            Charge.objects.all().delete()
            Expense.objects.all().delete()
            DailyClosure.objects.all().delete()
            Student.objects.all().delete()
            Guardian.objects.all().delete()
            Site.objects.all().delete()

        sites = [
            {"name": "Roma", "code": "roma", "address": "CDMX - Roma", "latitude": 19.419444, "longitude": -99.164722},
            {"name": "Coyoacan", "code": "coyoacan", "address": "CDMX - Coyoacan", "latitude": 19.349167, "longitude": -99.161667},
            {"name": "Santa Fe", "code": "santa-fe", "address": "CDMX - Santa Fe", "latitude": 19.359722, "longitude": -99.276389},
        ]
        site_map = {}
        for data in sites:
            site, _ = Site.objects.update_or_create(code=data["code"], defaults=data)
            site_map[data["code"]] = site

        users = [
            {
                "username": "admin",
                "email": "admin@futsi.local",
                "first_name": "Admin",
                "last_name": "Futsi",
                "role": "admin",
                "is_staff": True,
                "is_superuser": True,
                "primary_site": None,
                "avatar_url": "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop",
            },
            {
                "username": "contador",
                "email": "contador@futsi.local",
                "first_name": "Auxiliar",
                "last_name": "Contable",
                "role": "accounting",
                "primary_site": None,
                "avatar_url": "https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=200&h=200&fit=crop",
            },
            {
                "username": "coordinador.roma",
                "email": "coordinador.roma@futsi.local",
                "first_name": "Coord",
                "last_name": "Roma",
                "role": "site_coordinator",
                "primary_site": site_map["roma"],
                "avatar_url": "https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?w=200&h=200&fit=crop",
            },
            {
                "username": "caja.roma",
                "email": "caja.roma@futsi.local",
                "first_name": "Caja",
                "last_name": "Roma",
                "role": "cashier",
                "primary_site": site_map["roma"],
                "avatar_url": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
            },
            {
                "username": "caja.coyoacan",
                "email": "caja.coyoacan@futsi.local",
                "first_name": "Caja",
                "last_name": "Coyoacan",
                "role": "cashier",
                "primary_site": site_map["coyoacan"],
                "avatar_url": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop",
            },
            {
                "username": "coach.roma",
                "email": "coach.roma@futsi.local",
                "first_name": "Marco",
                "last_name": "Sanchez",
                "role": "coach",
                "primary_site": site_map["roma"],
                "phone": "5500007777",
                "coach_group_name": "Equipo Sub-12 A",
                "coach_hourly_rate": 250,
                "avatar_url": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=200&h=200&fit=crop",
            },
        ]
        for data in users:
            password = "admin12345" if data["username"] == "admin" else "demo12345"
            user, _ = User.objects.update_or_create(username=data["username"], defaults=data)
            user.set_password(password)
            user.save()

        guardians = [
            {"full_name": "Laura Martinez", "phone": "5511111111", "email": "laura@example.com"},
            {"full_name": "Roberto Gomez", "phone": "5522222222", "email": "roberto@example.com"},
            {"full_name": "Sofia Hernandez", "phone": "5533333333", "email": "sofia@example.com"},
            {"full_name": "Daniela Ruiz", "phone": "5544444444", "email": "daniela@example.com"},
            {"full_name": "Mariana Torres", "phone": "5555555555", "email": "mariana@example.com"},
            {"full_name": "Jorge Ramirez", "phone": "5566666666", "email": "jorge@example.com"},
            {"full_name": "Patricia Leon", "phone": "5577777777", "email": "patricia@example.com"},
            {"full_name": "Andres Castillo", "phone": "5588888888", "email": "andres@example.com"},
            {"full_name": "Claudia Vargas", "phone": "5599999999", "email": "claudia@example.com"},
            {"full_name": "Miguel Navarro", "phone": "5512121212", "email": "miguel@example.com"},
            {"full_name": "Fernanda Silva", "phone": "5534343434", "email": "fernanda@example.com"},
            {"full_name": "Oscar Medina", "phone": "5556565656", "email": "oscar@example.com"},
        ]
        guardian_map = {}
        for data in guardians:
            guardian, _ = Guardian.objects.update_or_create(phone=data["phone"], defaults=data)
            guardian_map[data["phone"]] = guardian

        guardian_users = [
            ("padre.laura", guardian_map["5511111111"]),
            ("padre.roberto", guardian_map["5522222222"]),
            ("padre.daniela", guardian_map["5544444444"]),
            ("padre.jorge", guardian_map["5566666666"]),
        ]
        for username, guardian in guardian_users:
            first_name = guardian.full_name.split()[0]
            user, _ = User.objects.update_or_create(
                username=username,
                defaults={
                    "email": guardian.email,
                    "first_name": first_name,
                    "last_name": "Representante",
                    "role": "guardian",
                    "phone": guardian.phone,
                    "avatar_url": "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop",
                    "is_staff": False,
                    "is_superuser": False,
                },
            )
            user.set_password("familia12345")
            user.save()
            guardian.user = user
            guardian.save(update_fields=["user", "updated_at"])

        students = [
            {
                "full_name": "Mateo Martinez",
                "guardian": guardian_map["5511111111"],
                "site": site_map["roma"],
                "birth_date": "2015-04-12",
                "category": "Sub-10",
                "group_name": "Lunes 5pm",
                "status": "active",
                "uniform_status": "delivered",
                "photo_url": "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=200&h=200&fit=crop",
                "waiver_url": "https://demo.futsi.local/responsivas/mateo.pdf",
                "medical_notes": "Sin alergias reportadas.",
            },
            {
                "full_name": "Diego Torres",
                "guardian": guardian_map["5555555555"],
                "site": site_map["roma"],
                "birth_date": "2015-08-20",
                "category": "Sub-10",
                "group_name": "Lunes 5pm",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Valentina Ramirez",
                "guardian": guardian_map["5566666666"],
                "site": site_map["roma"],
                "birth_date": "2016-02-14",
                "category": "Sub-10",
                "group_name": "Lunes 5pm",
                "status": "active",
                "uniform_status": "pending",
            },
            {
                "full_name": "Emilia Martinez",
                "guardian": guardian_map["5511111111"],
                "site": site_map["roma"],
                "birth_date": "2017-09-03",
                "category": "Sub-8",
                "group_name": "Miercoles 4pm",
                "status": "active",
                "uniform_status": "pending",
            },
            {
                "full_name": "Regina Leon",
                "guardian": guardian_map["5577777777"],
                "site": site_map["roma"],
                "birth_date": "2017-05-05",
                "category": "Sub-8",
                "group_name": "Miercoles 4pm",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Samuel Castillo",
                "guardian": guardian_map["5588888888"],
                "site": site_map["roma"],
                "birth_date": "2018-03-11",
                "category": "Sub-8",
                "group_name": "Miercoles 4pm",
                "status": "trial",
                "uniform_status": "pending",
                "photo_url": "https://images.unsplash.com/photo-1491013516836-7db643ee125a?w=200&h=200&fit=crop",
                "waiver_url": "https://demo.futsi.local/responsivas/samuel.pdf",
            },
            {
                "full_name": "Luis Gomez",
                "guardian": guardian_map["5522222222"],
                "site": site_map["coyoacan"],
                "birth_date": "2013-01-21",
                "category": "Sub-12",
                "group_name": "Martes 6pm",
                "status": "trial",
            },
            {
                "full_name": "Nicolas Vargas",
                "guardian": guardian_map["5599999999"],
                "site": site_map["coyoacan"],
                "birth_date": "2013-07-17",
                "category": "Sub-12",
                "group_name": "Martes 6pm",
                "status": "active",
            },
            {
                "full_name": "Camila Navarro",
                "guardian": guardian_map["5512121212"],
                "site": site_map["coyoacan"],
                "birth_date": "2014-10-09",
                "category": "Sub-12",
                "group_name": "Martes 6pm",
                "status": "active",
            },
            {
                "full_name": "Ana Hernandez",
                "guardian": guardian_map["5533333333"],
                "site": site_map["santa-fe"],
                "birth_date": "2011-11-30",
                "category": "Sub-14",
                "group_name": "Jueves 7pm",
                "status": "paused",
                "pause_start": "2026-05-01",
                "pause_end": "2026-05-31",
                "pause_reason": "Viaje familiar autorizado",
            },
            {
                "full_name": "Lucia Silva",
                "guardian": guardian_map["5534343434"],
                "site": site_map["santa-fe"],
                "birth_date": "2012-12-01",
                "category": "Sub-14",
                "group_name": "Jueves 7pm",
                "status": "active",
            },
            {
                "full_name": "Tomas Medina",
                "guardian": guardian_map["5556565656"],
                "site": site_map["santa-fe"],
                "birth_date": "2011-04-27",
                "category": "Sub-14",
                "group_name": "Jueves 7pm",
                "status": "active",
            },
            {
                "full_name": "Carlos Ruiz",
                "guardian": guardian_map["5544444444"],
                "site": site_map["roma"],
                "birth_date": "2014-06-18",
                "category": "Sub-12",
                "group_name": "Sabado 9am",
                "status": "injured",
                "photo_url": "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=200&h=200&fit=crop",
                "waiver_url": "https://demo.futsi.local/responsivas/carlos.pdf",
                "medical_notes": "Lesion de tobillo reportada. Evitar carga intensa.",
            },
            {
                "full_name": "Bruno Torres",
                "guardian": guardian_map["5555555555"],
                "site": site_map["roma"],
                "birth_date": "2014-01-08",
                "category": "Sub-12",
                "group_name": "Sabado 9am",
                "status": "active",
            },
            {
                "full_name": "Isabella Ramirez",
                "guardian": guardian_map["5566666666"],
                "site": site_map["roma"],
                "birth_date": "2014-09-19",
                "category": "Sub-12",
                "group_name": "Sabado 9am",
                "status": "active",
            },
            {
                "full_name": "Adrian Perez",
                "guardian": guardian_map["5577777777"],
                "site": site_map["roma"],
                "birth_date": "2014-02-10",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
                "photo_url": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop",
            },
            {
                "full_name": "Gael Hernandez",
                "guardian": guardian_map["5533333333"],
                "site": site_map["roma"],
                "birth_date": "2014-03-21",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Santiago Vega",
                "guardian": guardian_map["5588888888"],
                "site": site_map["roma"],
                "birth_date": "2014-04-02",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "paid",
            },
            {
                "full_name": "Emiliano Cruz",
                "guardian": guardian_map["5599999999"],
                "site": site_map["roma"],
                "birth_date": "2014-05-16",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Leonardo Salas",
                "guardian": guardian_map["5512121212"],
                "site": site_map["roma"],
                "birth_date": "2014-06-09",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "pending",
            },
            {
                "full_name": "Rodrigo Flores",
                "guardian": guardian_map["5534343434"],
                "site": site_map["roma"],
                "birth_date": "2014-07-13",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
                "medical_notes": "Usa inhalador preventivo antes de esfuerzo intenso.",
            },
            {
                "full_name": "Maximiliano Ortega",
                "guardian": guardian_map["5556565656"],
                "site": site_map["roma"],
                "birth_date": "2014-08-24",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Sebastian Rojas",
                "guardian": guardian_map["5522222222"],
                "site": site_map["roma"],
                "birth_date": "2014-09-04",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "paid",
            },
            {
                "full_name": "Andres Molina",
                "guardian": guardian_map["5544444444"],
                "site": site_map["roma"],
                "birth_date": "2014-10-18",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Hugo Pineda",
                "guardian": guardian_map["5511111111"],
                "site": site_map["roma"],
                "birth_date": "2014-11-30",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "trial",
                "uniform_status": "pending",
            },
            {
                "full_name": "Rafael Campos",
                "guardian": guardian_map["5555555555"],
                "site": site_map["roma"],
                "birth_date": "2014-12-08",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
            },
            {
                "full_name": "Pablo Ibarra",
                "guardian": guardian_map["5566666666"],
                "site": site_map["roma"],
                "birth_date": "2015-01-15",
                "category": "Sub-12",
                "group_name": "Equipo Sub-12 A",
                "status": "active",
                "uniform_status": "delivered",
            },
        ]
        student_map = {}
        admin = User.objects.get(username="admin")
        for data in students:
            student, _ = Student.objects.update_or_create(
                full_name=data["full_name"],
                guardian=data["guardian"],
                defaults=data,
            )
            student_map[data["full_name"]] = student

        Charge.objects.update_or_create(
            student=student_map["Luis Gomez"],
            concept="Mensualidad",
            status="pending",
            defaults={
                "site": student_map["Luis Gomez"].site,
                "description": "Mensualidad demo pendiente",
                "amount": 1500,
                "due_date": "2026-05-10",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Carlos Ruiz"],
            concept="Uniforme",
            status="partial",
            defaults={
                "site": student_map["Carlos Ruiz"].site,
                "description": "Saldo demo de uniforme",
                "amount": 450,
                "due_date": "2026-05-15",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Bruno Torres"],
            concept="Jornada torneo",
            status="pending",
            defaults={
                "site": student_map["Bruno Torres"].site,
                "description": "Jornada 4 - Sabado 9am",
                "amount": 650,
                "due_date": "2026-05-30",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Isabella Ramirez"],
            concept="Liguilla",
            status="pending",
            defaults={
                "site": student_map["Isabella Ramirez"].site,
                "description": "Semifinal torneo escolar",
                "amount": 800,
                "due_date": "2026-05-30",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Leonardo Salas"],
            concept="Mensualidad",
            status="pending",
            defaults={
                "site": student_map["Leonardo Salas"].site,
                "description": "Mensualidad mayo",
                "amount": 1500,
                "due_date": "2026-05-10",
                "created_by": admin,
            },
        )
        mateo_charge, _ = Charge.objects.update_or_create(
            student=student_map["Mateo Martinez"],
            concept="Mensualidad",
            status="paid",
            defaults={
                "site": student_map["Mateo Martinez"].site,
                "description": "Mensualidad mayo pagada",
                "amount": 1500,
                "due_date": "2026-05-10",
                "created_by": admin,
            },
        )
        Payment.objects.update_or_create(
            charge=mateo_charge,
            method="card",
            amount=1500,
            defaults={
                "site": mateo_charge.site,
                "student": mateo_charge.student,
                "team": None,
                "channel": "card_terminal",
                "status": "registered",
                "paid_at": timezone.now(),
                "confirmed_at": timezone.now(),
                "reference": "TERM-DEMO-MATEO",
                "received_by": User.objects.get(username="caja.roma"),
                "notes": "Pago demo confirmado por terminal.",
            },
        )

        bruno_charge = Charge.objects.get(student=student_map["Bruno Torres"], concept="Jornada torneo")
        bruno_charge.status = "paid"
        bruno_charge.save(update_fields=["status", "updated_at"])
        Payment.objects.update_or_create(
            charge=bruno_charge,
            method="cash",
            amount=650,
            defaults={
                "site": bruno_charge.site,
                "student": bruno_charge.student,
                "team": None,
                "channel": "cash_confirmation",
                "status": "registered",
                "paid_at": timezone.now(),
                "confirmed_at": timezone.now(),
                "reference": "EFECTIVO-DEMO-BRUNO",
                "received_by": User.objects.get(username="caja.roma"),
                "notes": "Pago demo en efectivo aceptado.",
            },
        )

        coach = User.objects.get(username="coach.roma")
        CoachWorkLog.objects.update_or_create(
            coach=coach,
            work_date="2026-05-25",
            activity="Entrenamiento",
            defaults={
                "site": site_map["roma"],
                "group_name": "Equipo Sub-12 A",
                "hours": 2,
                "notes": "Sesion tactica y definicion.",
                "hourly_rate_snapshot": coach.coach_hourly_rate,
                "created_by": coach,
            },
        )

        Expense.objects.update_or_create(
            site=site_map["roma"],
            category="Pago a coaches",
            description="Coach academia sabado",
            expense_date="2026-05-25",
            defaults={
                "amount": 1200,
                "provider_name": "Coach demo",
                "status": "pending",
                "captured_by": admin,
            },
        )
        Expense.objects.update_or_create(
            site=site_map["coyoacan"],
            category="Arbitraje",
            description="Arbitraje jornada demo",
            expense_date="2026-05-25",
            defaults={
                "amount": 800,
                "provider_name": "Arbitro demo",
                "status": "approved",
                "captured_by": admin,
                "approved_by": admin,
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Datos demo listos. Usuarios: admin/admin12345, contador/demo12345, coordinador.roma/demo12345, caja.roma/demo12345, coach.roma/demo12345"
            )
        )
