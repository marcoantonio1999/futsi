from datetime import datetime

from .common import *


def attendance_window_bounds(session):
    if not session.starts_at:
        return None, None
    current_tz = timezone.get_current_timezone()
    starts_on = timezone.make_aware(datetime.combine(session.date, session.starts_at), current_tz)
    if session.ends_at:
        ends_on = timezone.make_aware(datetime.combine(session.date, session.ends_at), current_tz)
        if ends_on <= starts_on:
            ends_on += timedelta(days=1)
        return starts_on, ends_on
    duration = max(1, int(session.duration_minutes or 120))
    return starts_on, starts_on + timedelta(minutes=duration)


def can_mark_session(session):
    if session.closed_at:
        return False
    now = timezone.localtime(timezone.now())
    if session.date != now.date():
        return False
    window_start, window_end = attendance_window_bounds(session)
    if not window_start or not window_end:
        return True
    return window_start <= now <= window_end


def attendance_window_label(session):
    window_start, window_end = attendance_window_bounds(session)
    if not window_start or not window_end:
        return "Disponible solo durante el dia de la sesion."
    return f"{timezone.localtime(window_start).strftime('%H:%M')} a {timezone.localtime(window_end).strftime('%H:%M')}"


def match_team_ids(match):
    if not match:
        return set()
    return {match.home_team_id, match.away_team_id}


def student_is_in_session_roster(student, session):
    if student.status == "dropped":
        return False
    if session.session_type == "academy_class":
        if student.site_id != session.site_id:
            return False
        return not session.group_name or student.group_name == session.group_name
    if session.session_type == "tournament_match":
        registrations = StudentTournamentRegistration.objects.filter(
            student=student,
            status="registered",
        )
        if session.tournament_id:
            registrations = registrations.filter(tournament_id=session.tournament_id)
        if session.team_id:
            registrations = registrations.filter(team_id=session.team_id)
        elif session.match_id:
            registrations = registrations.filter(team_id__in=match_team_ids(session.match))
        return registrations.exists()
    return False


class AttendanceSessionSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    tournament_name = serializers.CharField(source="tournament.name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    match_name = serializers.SerializerMethodField()
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)
    record_count = serializers.IntegerField(read_only=True)
    can_mark_attendance = serializers.SerializerMethodField()
    attendance_window = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceSession
        fields = "__all__"
        read_only_fields = ["captured_by", "closed_at"]

    def get_match_name(self, obj):
        if not obj.match_id:
            return ""
        return f"{obj.match.home_team.name} vs {obj.match.away_team.name}"

    def get_can_mark_attendance(self, obj):
        return can_mark_session(obj)

    def get_attendance_window(self, obj):
        return attendance_window_label(obj)

    def validate(self, attrs):
        match = attrs.get("match") or getattr(self.instance, "match", None)
        team = attrs.get("team") or getattr(self.instance, "team", None)
        starts_at = attrs.get("starts_at") or getattr(self.instance, "starts_at", None)
        ends_at = attrs.get("ends_at") or getattr(self.instance, "ends_at", None)
        session_date = attrs.get("date") or getattr(self.instance, "date", timezone.localdate())
        if starts_at and ends_at:
            starts_on = datetime.combine(session_date, starts_at)
            ends_on = datetime.combine(session_date, ends_at)
            if ends_on <= starts_on:
                ends_on += timedelta(days=1)
            attrs["duration_minutes"] = max(1, int((ends_on - starts_on).total_seconds() // 60))
        if match and team and team.id not in match_team_ids(match):
            raise serializers.ValidationError({"team": "El equipo no pertenece al partido seleccionado."})
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        match = validated_data.get("match")
        if match:
            validated_data["site"] = match.site
            validated_data["session_type"] = "tournament_match"
            validated_data["date"] = match.played_on
            validated_data["starts_at"] = match.starts_at
            validated_data["duration_minutes"] = match.duration_minutes
            if match.starts_at:
                starts_on = datetime.combine(match.played_on, match.starts_at)
                validated_data["ends_at"] = (starts_on + timedelta(minutes=max(1, int(match.duration_minutes or 120)))).time()
            validated_data["tournament"] = match.tournament
            validated_data["round"] = match.round
            validated_data["group_name"] = f"{match.home_team.name} vs {match.away_team.name}"
        if request and request.user.is_authenticated:
            validated_data["captured_by"] = request.user
        return super().create(validated_data)


class AttendanceRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = "__all__"
        read_only_fields = ["captured_by", "had_debt_at_capture"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["captured_by"] = request.user

        student = validated_data.get("student")
        team = validated_data.get("team")
        session = validated_data["session"]
        if not can_mark_session(session):
            raise serializers.ValidationError(
                {"session": f"El pase de lista solo esta disponible en la ventana operativa: {attendance_window_label(session)}"}
            )
        if student:
            if not student_is_in_session_roster(student, session):
                raise serializers.ValidationError({"student": "El alumno no pertenece al roster de esta sesion."})
            validated_data["had_debt_at_capture"] = student.charges.filter(status__in=["pending", "partial"]).exists()
            record, _ = AttendanceRecord.objects.update_or_create(
                session=session,
                student=student,
                defaults={key: value for key, value in validated_data.items() if key not in {"session", "student"}},
            )
            return record
        if team:
            validated_data["had_debt_at_capture"] = team.charges.filter(status__in=["pending", "partial"]).exists()
            record, _ = AttendanceRecord.objects.update_or_create(
                session=session,
                team=team,
                defaults={key: value for key, value in validated_data.items() if key not in {"session", "team"}},
            )
            return record
        return super().create(validated_data)


class CoachWorkLogSerializer(serializers.ModelSerializer):
    coach_username = serializers.CharField(source="coach.username", read_only=True)
    coach_name = serializers.SerializerMethodField()
    site_name = serializers.CharField(source="site.name", read_only=True)
    total_amount = serializers.SerializerMethodField()

    class Meta:
        model = CoachWorkLog
        fields = "__all__"
        read_only_fields = ["coach", "site", "group_name", "hourly_rate_snapshot", "created_by"]

    def get_coach_name(self, obj):
        return obj.coach.get_full_name() or obj.coach.username

    def get_total_amount(self, obj):
        return str(obj.hours * obj.hourly_rate_snapshot)

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            if request.user.role == "coach":
                validated_data["coach"] = request.user
                validated_data["site"] = request.user.primary_site
                validated_data["group_name"] = request.user.coach_group_name
                validated_data["hourly_rate_snapshot"] = request.user.coach_hourly_rate
            else:
                coach = validated_data.get("coach") or request.user
                validated_data["coach"] = coach
                validated_data["site"] = validated_data.get("site") or coach.primary_site
                validated_data["group_name"] = validated_data.get("group_name") or coach.coach_group_name
                validated_data["hourly_rate_snapshot"] = validated_data.get("hourly_rate_snapshot") or coach.coach_hourly_rate
            validated_data["created_by"] = request.user
        return super().create(validated_data)

