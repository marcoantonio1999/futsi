from datetime import datetime

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import (
    AttendanceRecord,
    AttendanceSession,
    CashMovement,
    Charge,
    CoachWorkLog,
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
            CashMovement.objects.all().delete()
            StaffPaymentRequest.objects.all().delete()
            FaceRecognitionAttempt.objects.all().delete()
            Invoice.objects.all().delete()
            HistoricalImportRow.objects.all().delete()
            HistoricalImport.objects.all().delete()
            CoachWorkLog.objects.all().delete()
            StudentAssessment.objects.all().delete()
            PlayerAttendanceRecord.objects.all().delete()
            Match.objects.all().delete()
            Round.objects.all().delete()
            AttendanceRecord.objects.all().delete()
            AttendanceSession.objects.all().delete()
            Payment.objects.all().delete()
            Discount.objects.all().delete()
            Charge.objects.all().delete()
            Expense.objects.all().delete()
            DailyClosure.objects.all().delete()
            StudentTournamentRegistration.objects.all().delete()
            Student.objects.all().delete()
            Player.objects.all().delete()
            Team.objects.all().delete()
            Tournament.objects.all().delete()
            Guardian.objects.all().delete()
            Site.objects.all().delete()
            User.objects.filter(role__in=["adult_representative", "adult_player"]).delete()

        sites = [
            {"name": "Roma", "code": "roma", "address": "CDMX - Roma", "latitude": 19.419444, "longitude": -99.164722},
            {"name": "Coyoacan", "code": "coyoacan", "address": "CDMX - Coyoacan", "latitude": 19.349167, "longitude": -99.161667},
            {"name": "Santa Fe", "code": "santa-fe", "address": "CDMX - Santa Fe", "latitude": 19.359722, "longitude": -99.276389},
            {"name": "Polanco", "code": "polanco", "address": "CDMX - Polanco", "latitude": 19.433333, "longitude": -99.200000},
            {"name": "Del Valle", "code": "del-valle", "address": "CDMX - Del Valle", "latitude": 19.384444, "longitude": -99.168333},
            {"name": "Narvarte", "code": "narvarte", "address": "CDMX - Narvarte", "latitude": 19.395833, "longitude": -99.155556},
            {"name": "Lomas", "code": "lomas", "address": "CDMX - Lomas de Chapultepec", "latitude": 19.428611, "longitude": -99.217222},
            {"name": "Interlomas", "code": "interlomas", "address": "EdoMex - Interlomas", "latitude": 19.403889, "longitude": -99.276389},
            {"name": "Satélite", "code": "satelite", "address": "EdoMex - Ciudad Satélite", "latitude": 19.510278, "longitude": -99.234167},
            {"name": "Cuajimalpa", "code": "cuajimalpa", "address": "CDMX - Cuajimalpa", "latitude": 19.357500, "longitude": -99.299167},
            {"name": "Tlalpan", "code": "tlalpan", "address": "CDMX - Tlalpan", "latitude": 19.287778, "longitude": -99.167778},
            {"name": "Lindavista", "code": "lindavista", "address": "CDMX - Lindavista", "latitude": 19.491389, "longitude": -99.134167},
            {"name": "Iztapalapa", "code": "iztapalapa", "address": "CDMX - Iztapalapa", "latitude": 19.357222, "longitude": -99.092500},
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
                "username": "dev",
                "email": "dev@futsi.local",
                "first_name": "Dev",
                "last_name": "App",
                "role": "dev",
                "is_staff": True,
                "is_superuser": False,
                "primary_site": None,
                "avatar_url": "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=200&h=200&fit=crop",
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
        coach_specs = [
            ("coach.roma.lunes", "Elena", "Mora", "roma", "Lunes 5pm", 230),
            ("coach.roma.miercoles", "Ivan", "Reyes", "roma", "Miercoles 4pm", 220),
            ("coach.coyoacan", "Paula", "Cortes", "coyoacan", "Martes 6pm", 240),
            ("coach.santafe", "Hector", "Luna", "santa-fe", "Jueves 7pm", 260),
            ("coach.polanco", "Sergio", "Ibarra", "polanco", "Demo 5pm", 280),
            ("coach.delvalle", "Clara", "Nunez", "del-valle", "Demo 5pm", 235),
            ("coach.narvarte", "Raul", "Pineda", "narvarte", "Demo 5pm", 225),
            ("coach.lomas", "Monica", "Arias", "lomas", "Demo 5pm", 290),
            ("coach.interlomas", "Javier", "Rios", "interlomas", "Demo 5pm", 275),
            ("coach.satelite", "Andrea", "Vega", "satelite", "Demo 5pm", 245),
            ("coach.cuajimalpa", "Brenda", "Solis", "cuajimalpa", "Demo 5pm", 230),
            ("coach.tlalpan", "Oscar", "Mena", "tlalpan", "Demo 5pm", 220),
            ("coach.lindavista", "Nadia", "Paz", "lindavista", "Demo 5pm", 225),
            ("coach.iztapalapa", "Victor", "Cano", "iztapalapa", "Demo 5pm", 215),
        ]
        for username, first_name, last_name, site_code, group_name, hourly_rate in coach_specs:
            users.append(
                {
                    "username": username,
                    "email": f"{username}@futsi.local",
                    "first_name": first_name,
                    "last_name": last_name,
                    "role": "coach",
                    "primary_site": site_map[site_code],
                    "phone": f"55{site_map[site_code].id:02d}{len(username):06d}"[:10],
                    "coach_group_name": group_name,
                    "coach_hourly_rate": hourly_rate,
                    "avatar_url": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=200&h=200&fit=crop",
                }
            )
        for data in users:
            if data["username"] == "admin":
                password = "admin12345"
            elif data["username"] == "dev":
                password = "dev12345"
            else:
                password = "demo12345"
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
            ("padre.sofia", guardian_map["5533333333"]),
            ("padre.daniela", guardian_map["5544444444"]),
            ("padre.mariana", guardian_map["5555555555"]),
            ("padre.jorge", guardian_map["5566666666"]),
            ("padre.patricia", guardian_map["5577777777"]),
            ("padre.andres", guardian_map["5588888888"]),
            ("padre.claudia", guardian_map["5599999999"]),
            ("padre.miguel", guardian_map["5512121212"]),
            ("padre.fernanda", guardian_map["5534343434"]),
            ("padre.oscar", guardian_map["5556565656"]),
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

        expansion_site_codes = ["polanco", "del-valle", "narvarte", "lomas", "interlomas", "satelite", "cuajimalpa", "tlalpan", "lindavista", "iztapalapa"]
        guardian_cycle = list(guardian_map.values())
        for site_index, site_code in enumerate(expansion_site_codes, start=1):
            for student_index in range(1, 13):
                guardian = guardian_cycle[(site_index + student_index) % len(guardian_cycle)]
                full_name = f"Alumno {site_map[site_code].name} {student_index:02d}"
                status = "active"
                if student_index == 11:
                    status = "trial"
                elif student_index == 12:
                    status = "paused"
                student, _ = Student.objects.update_or_create(
                    full_name=full_name,
                    guardian=guardian,
                    defaults={
                        "full_name": full_name,
                        "guardian": guardian,
                        "site": site_map[site_code],
                        "birth_date": f"2014-{(student_index % 9) + 1:02d}-12",
                        "category": "Sub-12",
                        "group_name": "Demo 5pm",
                        "status": status,
                        "uniform_status": "delivered" if student_index % 2 else "pending",
                        "pause_start": "2026-06-01" if status == "paused" else None,
                        "pause_end": "2026-06-30" if status == "paused" else None,
                        "pause_reason": "Pausa demo por viaje" if status == "paused" else "",
                    },
                )
                student_map[full_name] = student

        base_group_expansion = [
            ("roma", "Lunes 5pm", "Sub-10", "Roma Lunes", 9),
            ("roma", "Miercoles 4pm", "Sub-8", "Roma Miercoles", 9),
            ("coyoacan", "Martes 6pm", "Sub-12", "Coyoacan Martes", 12),
            ("santa-fe", "Jueves 7pm", "Sub-14", "Santa Fe Jueves", 12),
        ]
        for site_code, group_name, category, name_prefix, count in base_group_expansion:
            for student_index in range(1, count + 1):
                guardian = guardian_cycle[(student_index + len(name_prefix)) % len(guardian_cycle)]
                full_name = f"Alumno {name_prefix} {student_index:02d}"
                status = "active"
                if student_index == count:
                    status = "injured"
                elif student_index == count - 1:
                    status = "trial"
                student, _ = Student.objects.update_or_create(
                    full_name=full_name,
                    guardian=guardian,
                    defaults={
                        "full_name": full_name,
                        "guardian": guardian,
                        "site": site_map[site_code],
                        "birth_date": f"2013-{(student_index % 9) + 1:02d}-18",
                        "category": category,
                        "group_name": group_name,
                        "status": status,
                        "uniform_status": "delivered" if student_index % 3 else "pending",
                        "medical_notes": "Seguimiento demo de lesion." if status == "injured" else "",
                    },
                )
                student_map[full_name] = student

        Charge.objects.update_or_create(
            student=student_map["Luis Gomez"],
            concept="Mensualidad",
            defaults={
                "site": student_map["Luis Gomez"].site,
                "description": "Mensualidad demo pendiente",
                "amount": 1500,
                "due_date": "2026-05-10",
                "status": "pending",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Carlos Ruiz"],
            concept="Uniforme",
            defaults={
                "site": student_map["Carlos Ruiz"].site,
                "description": "Saldo demo de uniforme",
                "amount": 450,
                "due_date": "2026-05-15",
                "status": "partial",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Bruno Torres"],
            concept="Jornada torneo",
            defaults={
                "site": student_map["Bruno Torres"].site,
                "description": "Jornada 4 - Sabado 9am",
                "amount": 650,
                "due_date": "2026-05-30",
                "status": "pending",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Isabella Ramirez"],
            concept="Liguilla",
            defaults={
                "site": student_map["Isabella Ramirez"].site,
                "description": "Semifinal torneo escolar",
                "amount": 800,
                "due_date": "2026-05-30",
                "status": "pending",
                "created_by": admin,
            },
        )
        Charge.objects.update_or_create(
            student=student_map["Leonardo Salas"],
            concept="Mensualidad",
            defaults={
                "site": student_map["Leonardo Salas"].site,
                "description": "Mensualidad mayo",
                "amount": 1500,
                "due_date": "2026-05-10",
                "status": "pending",
                "created_by": admin,
            },
        )
        mateo_charge, _ = Charge.objects.update_or_create(
            student=student_map["Mateo Martinez"],
            concept="Mensualidad",
            defaults={
                "site": student_map["Mateo Martinez"].site,
                "description": "Mensualidad mayo pagada",
                "amount": 1500,
                "due_date": "2026-05-10",
                "status": "paid",
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

        bruno_charge = Charge.objects.filter(student=student_map["Bruno Torres"], concept="Jornada torneo").order_by("-updated_at").first()
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

        coach_work_log_specs = [
            ("coach.roma", "roma", "Equipo Sub-12 A", "2026-05-25", "Entrenamiento", 2, "Sesion tactica y definicion."),
            ("coach.roma", "roma", "Equipo Sub-12 A", "2026-05-27", "Entrenamiento", 2, "Trabajo de salida con balon y cierre defensivo."),
            ("coach.roma", "roma", "Equipo Sub-12 A", "2026-05-30", "Partido", 3, "Direccion de partido y charla post juego."),
            ("coach.roma.lunes", "roma", "Lunes 5pm", "2026-05-25", "Entrenamiento", 2, "Tecnica individual y pases cortos."),
            ("coach.roma.lunes", "roma", "Lunes 5pm", "2026-06-01", "Entrenamiento", 2, "Resistencia y definicion."),
            ("coach.roma.miercoles", "roma", "Miercoles 4pm", "2026-05-27", "Entrenamiento", 2, "Control orientado y rondos."),
            ("coach.coyoacan", "coyoacan", "Martes 6pm", "2026-05-26", "Entrenamiento", 2, "Calentamiento, tecnica y tiros a gol."),
            ("coach.coyoacan", "coyoacan", "Martes 6pm", "2026-05-30", "Partido", 3, "Acompanamiento de equipo en jornada."),
            ("coach.santafe", "santa-fe", "Jueves 7pm", "2026-05-28", "Entrenamiento", 2, "Transiciones defensa ataque."),
            ("coach.polanco", "polanco", "Demo 5pm", "2026-05-29", "Entrenamiento", 2, "Trabajo fisico y coordinacion."),
            ("coach.delvalle", "del-valle", "Demo 5pm", "2026-05-29", "Entrenamiento", 2, "Tecnica por estaciones."),
            ("coach.narvarte", "narvarte", "Demo 5pm", "2026-05-30", "Partido", 3, "Jornada escolar y retroalimentacion."),
        ]
        for username, site_code, group_name, work_date, activity, hours, notes in coach_work_log_specs:
            coach = User.objects.get(username=username)
            CoachWorkLog.objects.update_or_create(
                coach=coach,
                work_date=work_date,
                activity=activity,
                defaults={
                    "site": site_map[site_code],
                    "group_name": group_name,
                    "hours": hours,
                    "notes": notes,
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

        tournament, _ = Tournament.objects.update_or_create(
            site=site_map["roma"],
            name="Liga Escolar Sub-12 Apertura",
            defaults={
                "billing_type": "weekly_match",
                "starts_on": "2026-05-01",
                "expected_weeks": 12,
                "is_active": True,
            },
        )
        rounds = {}
        for number in [1, 2, 3, 4]:
            round_obj, _ = Round.objects.update_or_create(
                tournament=tournament,
                number=number,
                defaults={"starts_on": f"2026-05-{number * 7:02d}", "ends_on": f"2026-05-{number * 7 + 1:02d}"},
            )
            rounds[number] = round_obj

        team_specs = [
            ("Futsi Roma Sub-12", "Marco Sanchez", "5500007777"),
            ("Halcones Mixcoac", "Ernesto Paz", "5510101010"),
            ("Leones Del Valle", "Ramon Soto", "5520202020"),
            ("Cumbres FC", "Alan Mora", "5530303030"),
        ]
        teams = {}
        for name, rep, phone in team_specs:
            team, _ = Team.objects.update_or_create(
                tournament=tournament,
                name=name,
                defaults={"representative_name": rep, "representative_phone": phone, "representative_email": f"{name.lower().replace(' ', '.')}@demo.local"},
            )
            teams[name] = team

        academy_roster = [
            ("Adrian Perez", "Futsi Roma Sub-12", 1),
            ("Gael Hernandez", "Futsi Roma Sub-12", 7),
            ("Santiago Vega", "Futsi Roma Sub-12", 4),
            ("Rodrigo Flores", "Futsi Roma Sub-12", 8),
            ("Rafael Campos", "Futsi Roma Sub-12", 11),
            ("Emiliano Cruz", "Futsi Roma Sub-12", 5),
            ("Leonardo Salas", "Futsi Roma Sub-12", 2),
            ("Maximiliano Ortega", "Futsi Roma Sub-12", 10),
            ("Sebastian Rojas", "Futsi Roma Sub-12", 6),
            ("Hugo Pineda", "Futsi Roma Sub-12", 9),
            ("Andres Molina", "Futsi Roma Sub-12", 3),
            ("Pablo Ibarra", "Futsi Roma Sub-12", 14),
        ]
        for student_name, team_name, jersey_number in academy_roster:
            if student_name in student_map:
                StudentTournamentRegistration.objects.update_or_create(
                    tournament=tournament,
                    student=student_map[student_name],
                    defaults={
                        "team": teams[team_name],
                        "jersey_number": jersey_number,
                        "billing_type": "weekly_match",
                        "weekly_amount": 650,
                        "full_amount": 7800,
                        "billing_starts_on": tournament.starts_on,
                        "status": "registered",
                        "notes": "Registro demo de academia a torneo escolar.",
                        "registered_by": admin,
                    },
                )

        match_specs = [
            (1, "Futsi Roma Sub-12", "Halcones Mixcoac", 3, 1, "finished"),
            (1, "Leones Del Valle", "Cumbres FC", 2, 2, "finished"),
            (2, "Futsi Roma Sub-12", "Leones Del Valle", 1, 1, "finished"),
            (2, "Halcones Mixcoac", "Cumbres FC", 4, 2, "finished"),
            (3, "Futsi Roma Sub-12", "Cumbres FC", 2, 0, "live"),
            (3, "Halcones Mixcoac", "Leones Del Valle", 0, 1, "live"),
        ]
        for number, home, away, home_goals, away_goals, status in match_specs:
            Match.objects.update_or_create(
                tournament=tournament,
                round=rounds[number],
                home_team=teams[home],
                away_team=teams[away],
                defaults={
                    "site": site_map["roma"],
                    "played_on": f"2026-05-{number * 7:02d}",
                    "starts_at": "17:00",
                    "home_goals": home_goals,
                    "away_goals": away_goals,
                    "status": status,
                    "updated_by": User.objects.get(username="coordinador.roma"),
                },
            )

        assessment_specs = [
            ("Adrian Perez", 82, 68, 76, 71, 89, 80, 92, "Portero seguro, buen liderazgo."),
            ("Gael Hernandez", 88, 77, 72, 86, 63, 79, 84, "Extremo explosivo, mejorar regreso defensivo."),
            ("Santiago Vega", 73, 58, 69, 64, 91, 82, 80, "Central fuerte en duelos."),
            ("Rodrigo Flores", 78, 74, 84, 80, 69, 76, 88, "Buen pase entre lineas."),
            ("Rafael Campos", 91, 86, 70, 88, 55, 83, 79, "Define bien, trabajar presion tras perdida."),
        ]
        for name, pace, shooting, passing, dribbling, defense, physical, attitude, notes in assessment_specs:
            StudentAssessment.objects.update_or_create(
                student=student_map[name],
                assessment_month="2026-05-01",
                defaults={
                    "coach": coach,
                    "site": student_map[name].site,
                    "pace": pace,
                    "shooting": shooting,
                    "passing": passing,
                    "dribbling": dribbling,
                    "defense": defense,
                    "physical": physical,
                    "attitude": attitude,
                    "notes": notes,
                },
            )

        today = timezone.localdate()
        current_month = f"{today.year}-{today.month:02d}"
        caja_roma = User.objects.get(username="caja.roma")
        caja_coyoacan = User.objects.get(username="caja.coyoacan")

        def day(day_number):
            return f"{current_month}-{day_number:02d}"

        def create_charge_payment(subject, concept, description, amount, due_day, method, channel, paid_day, receiver, status="registered", paid_amount=None):
            subject_kwargs = {"student": subject, "team": None} if isinstance(subject, Student) else {"student": None, "team": subject}
            charge, _ = Charge.objects.update_or_create(
                concept=concept,
                **subject_kwargs,
                defaults={
                    "site": subject.site if isinstance(subject, Student) else subject.tournament.site,
                    "description": description,
                    "amount": amount,
                    "due_date": day(due_day),
                    "status": "paid" if (paid_amount or amount) >= amount else "partial",
                    "created_by": admin,
                },
            )
            payment_amount = paid_amount or amount
            Payment.objects.update_or_create(
                charge=charge,
                method=method,
                amount=payment_amount,
                defaults={
                    "site": charge.site,
                    "student": charge.student,
                    "team": charge.team,
                    "channel": channel,
                    "status": status,
                    "paid_at": datetime(today.year, today.month, paid_day, 18, 0, tzinfo=timezone.get_current_timezone()),
                    "confirmed_at": datetime(today.year, today.month, paid_day, 18, 5, tzinfo=timezone.get_current_timezone()),
                    "reference": f"DEMO-{charge.site.code.upper()}-{concept.upper().replace(' ', '-')}-{charge.id}",
                    "received_by": receiver,
                    "notes": "Dato demo para estimacion de ventas en tiempo real.",
                },
            )
            return charge

        extra_academy_payments = [
            ("Valentina Ramirez", "Mensualidad", "Mensualidad mes corriente", 1500, 5, "transfer", "transfer_clabe", 5, caja_roma),
            ("Regina Leon", "Mensualidad", "Mensualidad mes corriente", 1450, 8, "card", "card_terminal", 8, caja_roma),
            ("Nicolas Vargas", "Mensualidad", "Mensualidad mes corriente", 1350, 6, "cash", "cash_confirmation", 6, caja_coyoacan),
            ("Camila Navarro", "Mensualidad", "Mensualidad mes corriente", 1350, 10, "transfer", "transfer_clabe", 10, caja_coyoacan),
            ("Lucia Silva", "Mensualidad", "Mensualidad mes corriente", 1600, 7, "card", "card_terminal", 7, admin),
            ("Tomas Medina", "Mensualidad", "Mensualidad mes corriente", 1600, 12, "cash", "cash_confirmation", 12, admin),
            ("Adrian Perez", "Mensualidad", "Mensualidad equipo Sub-12", 1500, 14, "transfer", "transfer_clabe", 14, caja_roma),
            ("Gael Hernandez", "Mensualidad", "Mensualidad equipo Sub-12", 1500, 16, "card", "card_terminal", 16, caja_roma),
        ]
        for student_name, concept, description, amount, due_day, method, channel, paid_day, receiver in extra_academy_payments:
            create_charge_payment(student_map[student_name], concept, description, amount, due_day, method, channel, paid_day, receiver)

        extra_tournament_specs = [
            ("coyoacan", "Liga Coyoacan Nocturna", "weekly_match", [("Toros Coyoacan", "Mario Luna", "5544001001"), ("Pumas Sur", "Ivan Solis", "5544001002"), ("Atlas Taxquena", "Omar Rios", "5544001003"), ("Real Copilco", "Hector Cano", "5544001004")]),
            ("santa-fe", "Liga Santa Fe Empresarial", "weekly_match", [("Corporativo FC", "Luis Palma", "5544002001"), ("Bosque Real", "Pablo Vera", "5544002002"), ("Vista Hermosa", "Diego Neri", "5544002003")]),
            ("roma", "Copa Roma Completa", "full_tournament", [("Roma Norte FC", "Samuel Diaz", "5544003001"), ("Condesa United", "Raul Mejia", "5544003002")]),
            ("coyoacan", "Copa Coyoacan Completa", "full_tournament", [("Coyoacan Master", "Joel Paz", "5544004001"), ("Xotepingo FC", "Abel Mora", "5544004002")]),
        ]
        extra_team_map = {}
        for site_code, tournament_name, billing_type, teams_specs in extra_tournament_specs:
            extra_tournament, _ = Tournament.objects.update_or_create(
                site=site_map[site_code],
                name=tournament_name,
                defaults={"billing_type": billing_type, "starts_on": day(1), "expected_weeks": 12, "is_active": True},
            )
            for name, rep, phone in teams_specs:
                team, _ = Team.objects.update_or_create(
                    tournament=extra_tournament,
                    name=name,
                    defaults={"representative_name": rep, "representative_phone": phone, "representative_email": f"{name.lower().replace(' ', '.')}@demo.local"},
                )
                extra_team_map[name] = team

        team_payments = [
            ("Futsi Roma Sub-12", "Jornada torneo", "Jornada semanal Sub-12", 650, 9, "cash", "cash_confirmation", 9, caja_roma),
            ("Halcones Mixcoac", "Jornada torneo", "Jornada semanal Sub-12", 650, 12, "transfer", "transfer_clabe", 12, caja_roma),
            ("Toros Coyoacan", "Jornada torneo", "Liga Coyoacan jornada", 700, 9, "card", "card_terminal", 9, caja_coyoacan),
            ("Pumas Sur", "Jornada torneo", "Liga Coyoacan jornada", 700, 13, "cash", "cash_confirmation", 13, caja_coyoacan),
            ("Corporativo FC", "Jornada torneo", "Liga Santa Fe jornada", 850, 10, "transfer", "transfer_clabe", 10, admin),
            ("Bosque Real", "Jornada torneo", "Liga Santa Fe jornada", 850, 15, "card", "card_terminal", 15, admin),
            ("Roma Norte FC", "Torneo completo", "Abono torneo completo", 1100, 18, "transfer", "transfer_clabe", 18, caja_roma),
            ("Coyoacan Master", "Torneo completo", "Abono torneo completo", 1050, 20, "cash", "cash_confirmation", 20, caja_coyoacan),
        ]
        all_teams = {team.name: team for team in Team.objects.select_related("tournament", "tournament__site").all()}
        for team_name, concept, description, amount, due_day, method, channel, paid_day, receiver in team_payments:
            create_charge_payment(all_teams[team_name], concept, description, amount, due_day, method, channel, paid_day, receiver)

        growth_tournaments = [
            ("roma", "Liga Roma Sabatina Demo", "weekly_match", 10, 780, caja_roma),
            ("coyoacan", "Liga Coyoacan Premier Demo", "weekly_match", 8, 720, caja_coyoacan),
            ("santa-fe", "Liga Santa Fe Corporativa Demo", "weekly_match", 8, 900, admin),
            ("roma", "Torneo Roma Completo Demo", "full_tournament", 5, 4200, caja_roma),
            ("coyoacan", "Torneo Coyoacan Completo Demo", "full_tournament", 4, 3900, caja_coyoacan),
            ("santa-fe", "Torneo Santa Fe Completo Demo", "full_tournament", 4, 4600, admin),
        ]
        methods_cycle = [
            ("cash", "cash_confirmation"),
            ("transfer", "transfer_clabe"),
            ("card", "card_terminal"),
        ]
        for site_code, tournament_name, billing_type, team_count, amount, receiver in growth_tournaments:
            growth_tournament, _ = Tournament.objects.update_or_create(
                site=site_map[site_code],
                name=tournament_name,
                defaults={"billing_type": billing_type, "starts_on": day(1), "expected_weeks": 12, "is_active": True},
            )
            for index in range(1, team_count + 1):
                team, _ = Team.objects.update_or_create(
                    tournament=growth_tournament,
                    name=f"{site_map[site_code].name} Demo {index:02d}",
                    defaults={
                        "representative_name": f"Representante {site_map[site_code].name} {index:02d}",
                        "representative_phone": f"55{site_map[site_code].id:02d}{index:06d}"[:10],
                        "representative_email": f"demo.{site_code}.{index:02d}@demo.local",
                    },
                )
                method, channel = methods_cycle[index % len(methods_cycle)]
                concept = "Torneo completo" if billing_type == "full_tournament" else "Jornada torneo"
                create_charge_payment(
                    team,
                    concept,
                    f"{tournament_name} - {'abono torneo' if billing_type == 'full_tournament' else 'jornada semanal'}",
                    amount,
                    min(24, 6 + index),
                    method,
                    channel,
                    min(24, 6 + index),
                    receiver,
                )

        ancillary_income = [
            ("Roma", "Uniforme", "Venta uniforme academia", 1200, "card", "card_terminal", caja_roma),
            ("Roma", "Renta cancha", "Renta cancha nocturna", 4800, "transfer", "transfer_clabe", caja_roma),
            ("Roma", "Fiesta", "Evento infantil cancha", 6200, "cash", "cash_confirmation", caja_roma),
            ("Coyoacan", "Uniforme", "Venta uniforme academia", 950, "cash", "cash_confirmation", caja_coyoacan),
            ("Coyoacan", "Renta cancha", "Renta cancha fin de semana", 4200, "transfer", "transfer_clabe", caja_coyoacan),
            ("Coyoacan", "Sancion", "Sanciones torneo adultos", 1800, "card", "card_terminal", caja_coyoacan),
            ("Santa Fe", "Uniforme", "Venta uniforme academia", 1250, "card", "card_terminal", admin),
            ("Santa Fe", "Renta cancha", "Renta cancha corporativa", 7600, "transfer", "transfer_clabe", admin),
            ("Santa Fe", "Fiesta", "Evento corporativo cancha", 8800, "cash", "cash_confirmation", admin),
        ]
        site_student = {
            "Roma": student_map["Adrian Perez"],
            "Coyoacan": student_map["Nicolas Vargas"],
            "Santa Fe": student_map["Lucia Silva"],
        }
        for site_name, concept, description, amount, method, channel, receiver in ancillary_income:
            create_charge_payment(
                site_student[site_name],
                concept,
                description,
                amount,
                21,
                method,
                channel,
                21,
                receiver,
            )

        expansion_financials = [
            ("polanco", 7600, 52000, 43000),
            ("del-valle", 6100, 40500, 35500),
            ("narvarte", 5200, 34500, 32000),
            ("lomas", 8200, 57500, 48800),
            ("interlomas", 7900, 54800, 46200),
            ("satelite", 6500, 44600, 39800),
            ("cuajimalpa", 5800, 39200, 35000),
            ("tlalpan", 5600, 36600, 34200),
            ("lindavista", 6200, 41500, 37100),
            ("iztapalapa", 4900, 31800, 30200),
        ]
        for site_code, extra_income, expected_income, expense_amount in expansion_financials:
            receiver = caja_roma if site_code in {"polanco", "del-valle", "narvarte", "lomas", "interlomas"} else caja_coyoacan
            for student_index, method_data in enumerate(methods_cycle, start=1):
                method, channel = method_data
                create_charge_payment(
                    student_map[f"Alumno {site_map[site_code].name} {student_index:02d}"],
                    "Mensualidad",
                    f"Mensualidad demo {site_map[site_code].name}",
                    round(extra_income / 3, 2),
                    10 + student_index,
                    method,
                    channel,
                    10 + student_index,
                    receiver,
                )
            demo_tournament, _ = Tournament.objects.update_or_create(
                site=site_map[site_code],
                name=f"Liga {site_map[site_code].name} Demo",
                defaults={"billing_type": "weekly_match", "starts_on": day(1), "expected_weeks": 12, "is_active": True},
            )
            for index in range(1, 5):
                team, _ = Team.objects.update_or_create(
                    tournament=demo_tournament,
                    name=f"{site_map[site_code].name} Liga {index:02d}",
                    defaults={
                        "representative_name": f"Rep {site_map[site_code].name} {index:02d}",
                        "representative_phone": f"56{site_map[site_code].id:02d}{index:06d}"[:10],
                    },
                )
                method, channel = methods_cycle[index % len(methods_cycle)]
                create_charge_payment(
                    team,
                    "Jornada torneo",
                    f"Jornada demo {site_map[site_code].name}",
                    round((expected_income - extra_income) / 4, 2),
                    13 + index,
                    method,
                    channel,
                    13 + index,
                    receiver,
                )
            Expense.objects.update_or_create(
                site=site_map[site_code],
                category="Gastos operativos",
                description=f"Gasto operativo mensual {site_map[site_code].name}",
                expense_date=day(22),
                defaults={
                    "amount": expense_amount,
                    "provider_name": f"Operacion {site_map[site_code].name}",
                    "status": "approved",
                    "captured_by": admin,
                    "approved_by": admin,
                },
            )

        current_expenses = [
            ("roma", "Pago a coaches", "Nomina coaches Roma", 18200, "Coach staff", "approved"),
            ("roma", "Administracion", "Auxiliar administrativo Roma", 9200, "Admin Roma", "approved"),
            ("roma", "Arbitraje", "Arbitros jornadas Roma", 5600, "Colegio arbitral", "approved"),
            ("roma", "Renta de cancha", "Renta mensual cancha Roma", 15000, "Cancha Roma", "approved"),
            ("roma", "Publicidad", "Campana redes Roma", 2800, "Marketing demo", "approved"),
            ("coyoacan", "Pago a coaches", "Nomina coaches Coyoacan", 9800, "Coach staff", "approved"),
            ("coyoacan", "Administracion", "Auxiliar administrativo Coyoacan", 6200, "Admin Coyoacan", "approved"),
            ("coyoacan", "Arbitraje", "Arbitros jornadas Coyoacan", 4300, "Colegio arbitral", "approved"),
            ("coyoacan", "Renta de cancha", "Renta mensual cancha Coyoacan", 12000, "Cancha Coyoacan", "approved"),
            ("santa-fe", "Pago a coaches", "Nomina coaches Santa Fe", 11200, "Coach staff", "approved"),
            ("santa-fe", "Administracion", "Auxiliar administrativo Santa Fe", 7000, "Admin Santa Fe", "approved"),
            ("santa-fe", "Arbitraje", "Arbitros jornadas Santa Fe", 3900, "Colegio arbitral", "approved"),
            ("santa-fe", "Renta de cancha", "Renta mensual cancha Santa Fe", 18000, "Cancha Santa Fe", "approved"),
            ("santa-fe", "Corporativo", "Prorrata corporativa Santa Fe", 4500, "Direccion", "approved"),
        ]
        for site_code, category, description, amount, provider, status in current_expenses:
            Expense.objects.update_or_create(
                site=site_map[site_code],
                category=category,
                description=description,
                expense_date=day(22),
                defaults={
                    "amount": amount,
                    "provider_name": provider,
                    "status": status,
                    "captured_by": admin,
                    "approved_by": admin if status == "approved" else None,
                },
            )

        staff_payment_specs = [
            ("roma", "coach.roma", "coach_payroll", 3200, "Pago semanal coach Equipo Sub-12 A", "accepted"),
            ("roma", "coach.roma.lunes", "coach_payroll", 2800, "Pago semanal coach Lunes 5pm", "requested"),
            ("coyoacan", "coach.coyoacan", "coach_payroll", 3000, "Pago semanal coach Coyoacan", "requested"),
            ("roma", "caja.roma", "admin_payroll", 2500, "Apoyo administrativo caja Roma", "accepted"),
            ("coyoacan", "caja.coyoacan", "referee_payroll", 1800, "Pago arbitraje jornada Coyoacan", "requested"),
        ]
        for site_code, username, kind, amount, description, request_status in staff_payment_specs:
            recipient = User.objects.get(username=username)
            requested_by = caja_roma if site_code == "roma" else caja_coyoacan
            payment_request, _ = StaffPaymentRequest.objects.update_or_create(
                site=site_map[site_code],
                recipient=recipient,
                description=description,
                defaults={
                    "kind": kind,
                    "amount": amount,
                    "requested_payment_date": day(25),
                    "payment_method": "cash",
                    "status": request_status,
                    "requested_by": requested_by,
                    "accepted_at": timezone.now() if request_status == "accepted" else None,
                    "response_notes": "Pago recibido y aceptado en app." if request_status == "accepted" else "",
                },
            )
            if request_status == "accepted":
                expense, _ = Expense.objects.update_or_create(
                    site=site_map[site_code],
                    category=payment_request.get_kind_display(),
                    description=description,
                    expense_date=day(25),
                    defaults={
                        "amount": amount,
                        "provider_name": recipient.get_full_name() or recipient.username,
                        "status": "approved",
                        "captured_by": requested_by,
                        "approved_by": recipient,
                    },
                )
                payment_request.expense = expense
                payment_request.save(update_fields=["expense", "updated_at"])
                CashMovement.objects.update_or_create(
                    site=site_map[site_code],
                    staff_payment_request=payment_request,
                    movement_type="cash_out",
                    defaults={
                        "amount": amount,
                        "movement_date": day(25),
                        "reason": f"Pago aceptado: {description}",
                        "responsible": recipient,
                        "created_by": requested_by,
                        "notes": "Salida de efectivo por nomina aceptada por receptor.",
                    },
                )

        cash_transfer_specs = [
            ("roma", "vault_transfer", 12000, "Retiro a resguardo por exceso de efectivo en caja", "caja.roma"),
            ("coyoacan", "vault_transfer", 8000, "Retiro a resguardo por corte preventivo", "caja.coyoacan"),
            ("roma", "cash_in", 2000, "Fondo inicial de caja", "caja.roma"),
        ]
        for site_code, movement_type, amount, reason, username in cash_transfer_specs:
            responsible = User.objects.get(username=username)
            CashMovement.objects.update_or_create(
                site=site_map[site_code],
                movement_type=movement_type,
                reason=reason,
                movement_date=day(26),
                defaults={
                    "amount": amount,
                    "responsible": responsible,
                    "created_by": responsible,
                    "notes": "Movimiento fisico de caja; no duplica ingreso ni egreso contable.",
                },
            )

        adult_first_names = [
            "Alex", "Bruno", "Carlos", "Diego", "Emilio", "Fabian", "Gael", "Hugo",
            "Ivan", "Jorge", "Kevin", "Luis", "Mario", "Nicolas", "Oscar", "Pablo",
        ]
        adult_last_names = [
            "Aguilar", "Benitez", "Cano", "Diaz", "Escobar", "Flores", "Garcia", "Herrera",
            "Ibarra", "Juarez", "Lopez", "Mendez", "Nava", "Ortega", "Perez", "Rios",
        ]
        for team in Team.objects.select_related("tournament", "tournament__site").all():
            rep_username = f"rep.{team.id}.{team.name.lower().replace(' ', '').replace('-', '')}"[:45]
            rep_user, _ = User.objects.update_or_create(
                username=rep_username,
                defaults={
                    "email": team.representative_email or f"{rep_username}@futsi.local",
                    "first_name": team.representative_name.split()[0] if team.representative_name else "Representante",
                    "last_name": "Adultos",
                    "role": "adult_representative",
                    "primary_site": team.tournament.site,
                    "phone": team.representative_phone,
                    "is_staff": False,
                    "is_superuser": False,
                },
            )
            rep_user.set_password("adulto12345")
            rep_user.save()
            team.representative_user = rep_user
            team.save(update_fields=["representative_user", "updated_at"])

            clean_team = "".join(char for char in team.name.lower() if char.isalnum())[:14]
            for index in range(16):
                full_name = f"{adult_first_names[index]} {adult_last_names[(team.id + index) % len(adult_last_names)]}"
                username = f"jugador.{team.id}.{index + 1:02d}.{clean_team}"[:50]
                player_user = None
                if index == 0:
                    player_user, _ = User.objects.update_or_create(
                        username=username,
                        defaults={
                            "email": f"{username}@futsi.local",
                            "first_name": adult_first_names[index],
                            "last_name": adult_last_names[(team.id + index) % len(adult_last_names)],
                            "role": "adult_player",
                            "primary_site": team.tournament.site,
                            "phone": f"55{team.id:03d}{index + 1:05d}"[:10],
                            "is_staff": False,
                            "is_superuser": False,
                        },
                    )
                    player_user.set_password("adulto12345")
                    player_user.save()
                Player.objects.update_or_create(
                    team=team,
                    jersey_number=index + 1,
                    defaults={
                        "user": player_user,
                        "full_name": full_name,
                        "phone": player_user.phone if player_user else f"55{team.id:03d}{index + 1:05d}"[:10],
                        "email": player_user.email if player_user else f"{username}@futsi.local",
                        "photo_url": f"https://ui-avatars.com/api/?name={full_name.replace(' ', '+')}&background=1d4ed8&color=fff",
                        "is_active": True,
                    },
                )

        self.stdout.write(
            self.style.SUCCESS(
                "Datos demo listos. Usuarios: admin/admin12345, dev/dev12345, contador/demo12345, coordinador.roma/demo12345, caja.roma/demo12345, coach.roma/demo12345 y coaches por sede con demo12345"
            )
        )
