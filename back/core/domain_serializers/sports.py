from .common import *
from .attendance import attendance_window_label, can_mark_session, match_team_ids
from .money import charge_balance
from core.services.match_sessions import ensure_match_attendance_sessions

class TournamentSerializer(serializers.ModelSerializer):
    site = serializers.PrimaryKeyRelatedField(queryset=Site.objects.only("id"))

    class Meta:
        model = Tournament
        fields = "__all__"


class TeamSerializer(serializers.ModelSerializer):
    tournament = serializers.PrimaryKeyRelatedField(
        queryset=Tournament.objects.select_related("site").only(
            "id",
            "site_id",
            "name",
            "site__id",
            "site__name",
        )
    )
    tournament_name = serializers.CharField(source="tournament.name", read_only=True)
    site = serializers.IntegerField(source="tournament.site_id", read_only=True)
    site_name = serializers.CharField(source="tournament.site.name", read_only=True)
    player_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Team
        fields = "__all__"


class StudentTournamentRegistrationSerializer(serializers.ModelSerializer):
    tournament = serializers.PrimaryKeyRelatedField(
        queryset=Tournament.objects.select_related("site").only(
            "id",
            "site_id",
            "name",
            "billing_type",
            "starts_on",
            "expected_weeks",
            "site__id",
            "site__name",
        )
    )
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.only("id", "full_name", "category", "group_name"))
    team = serializers.PrimaryKeyRelatedField(queryset=Team.objects.only("id", "name"), required=False, allow_null=True)
    tournament_name = serializers.CharField(source="tournament.name", read_only=True)
    site = serializers.IntegerField(source="tournament.site_id", read_only=True)
    site_name = serializers.CharField(source="tournament.site.name", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_category = serializers.CharField(source="student.category", read_only=True)
    student_group_name = serializers.CharField(source="student.group_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    registered_by_username = serializers.CharField(source="registered_by.username", read_only=True)

    class Meta:
        model = StudentTournamentRegistration
        fields = "__all__"
        read_only_fields = ["registered_by"]

    def validate(self, attrs):
        tournament = attrs.get("tournament") or getattr(self.instance, "tournament", None)
        billing_type = attrs.get("billing_type")
        if tournament and not billing_type:
            attrs["billing_type"] = tournament.billing_type
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["registered_by"] = request.user
        if not validated_data.get("billing_starts_on") and validated_data.get("tournament"):
            validated_data["billing_starts_on"] = validated_data["tournament"].starts_on
        if not validated_data.get("billing_type") and validated_data.get("tournament"):
            validated_data["billing_type"] = validated_data["tournament"].billing_type
        if not validated_data.get("full_amount") and validated_data.get("weekly_amount") and validated_data.get("tournament"):
            validated_data["full_amount"] = validated_data["weekly_amount"] * (validated_data["tournament"].expected_weeks or 12)
        return super().create(validated_data)


class PlayerSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    tournament = serializers.IntegerField(source="team.tournament_id", read_only=True)
    tournament_name = serializers.CharField(source="team.tournament.name", read_only=True)
    site = serializers.IntegerField(source="team.tournament.site_id", read_only=True)
    site_name = serializers.CharField(source="team.tournament.site.name", read_only=True)

    class Meta:
        model = Player
        fields = "__all__"


class PlayerAttendanceRecordSerializer(serializers.ModelSerializer):
    player_name = serializers.CharField(source="player.full_name", read_only=True)
    team = serializers.IntegerField(source="player.team_id", read_only=True)
    team_name = serializers.CharField(source="player.team.name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)

    class Meta:
        model = PlayerAttendanceRecord
        fields = "__all__"
        read_only_fields = ["captured_by", "had_team_debt_at_capture"]

    def create(self, validated_data):
        request = self.context.get("request")
        player = validated_data["player"]
        session = validated_data["session"]
        if not can_mark_session(session):
            raise serializers.ValidationError(
                {"session": f"El pase de lista solo esta disponible en la ventana operativa: {attendance_window_label(session)}"}
            )
        allowed_team_ids = {session.team_id} if session.team_id else set()
        if not session.team_id and session.match_id:
            allowed_team_ids.update(match_team_ids(session.match))
        if session.session_type != "tournament_match" or player.team_id not in allowed_team_ids:
            raise serializers.ValidationError({"player": "El jugador no pertenece al roster de esta sesion."})
        team_balance = sum(charge_balance(charge) for charge in player.team.charges.exclude(status="canceled"))
        validated_data["had_team_debt_at_capture"] = team_balance > 0
        if request and request.user.is_authenticated:
            validated_data["captured_by"] = request.user
        record, _ = PlayerAttendanceRecord.objects.update_or_create(
            session=session,
            player=player,
            defaults=validated_data,
        )
        return record


class RoundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Round
        fields = "__all__"


class MatchSerializer(serializers.ModelSerializer):
    tournament_name = serializers.CharField(source="tournament.name", read_only=True)
    site_name = serializers.CharField(source="site.name", read_only=True)
    round_number = serializers.IntegerField(source="round.number", read_only=True)
    home_team_name = serializers.CharField(source="home_team.name", read_only=True)
    away_team_name = serializers.CharField(source="away_team.name", read_only=True)
    updated_by_username = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = Match
        fields = "__all__"
        read_only_fields = ["updated_by"]

    def validate(self, attrs):
        home_team = attrs.get("home_team") or getattr(self.instance, "home_team", None)
        away_team = attrs.get("away_team") or getattr(self.instance, "away_team", None)
        if home_team and away_team and home_team == away_team:
            raise serializers.ValidationError("Un equipo no puede jugar contra si mismo.")
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["updated_by"] = request.user
        match = super().create(validated_data)
        ensure_match_attendance_sessions(match, request.user if request else None)
        return match

    def update(self, instance, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["updated_by"] = request.user
        match = super().update(instance, validated_data)
        ensure_match_attendance_sessions(match, request.user if request else None)
        return match


class StudentAssessmentSerializer(serializers.ModelSerializer):
    student = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.select_related("site").only(
            "id",
            "site_id",
            "full_name",
            "photo_url",
            "category",
            "group_name",
            "site__id",
            "site__name",
        )
    )
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_photo_url = serializers.CharField(source="student.photo_url", read_only=True)
    category = serializers.CharField(source="student.category", read_only=True)
    group_name = serializers.CharField(source="student.group_name", read_only=True)
    site_name = serializers.CharField(source="site.name", read_only=True)
    coach_name = serializers.SerializerMethodField()
    overall_rating = serializers.IntegerField(read_only=True)

    class Meta:
        model = StudentAssessment
        fields = "__all__"
        read_only_fields = ["coach", "site"]

    def get_coach_name(self, obj):
        return obj.coach.get_full_name() or obj.coach.username

    def validate(self, attrs):
        for field in ["pace", "shooting", "passing", "dribbling", "defense", "physical", "attitude"]:
            value = attrs.get(field)
            if value is not None and (value < 0 or value > 100):
                raise serializers.ValidationError({field: "Debe estar entre 0 y 100."})
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        student = validated_data["student"]
        if request and request.user.is_authenticated:
            validated_data["coach"] = request.user
        validated_data["site"] = student.site
        assessment, _ = StudentAssessment.objects.update_or_create(
            student=student,
            assessment_month=validated_data["assessment_month"],
            defaults=validated_data,
        )
        return assessment

    def update(self, instance, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["coach"] = request.user
        validated_data["site"] = validated_data.get("student", instance.student).site
        return super().update(instance, validated_data)


class StudentValueAssessmentSerializer(serializers.ModelSerializer):
    student = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.select_related("site").only(
            "id",
            "site_id",
            "full_name",
            "photo_url",
            "category",
            "group_name",
            "site__id",
            "site__name",
        )
    )
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_photo_url = serializers.CharField(source="student.photo_url", read_only=True)
    category = serializers.CharField(source="student.category", read_only=True)
    group_name = serializers.CharField(source="student.group_name", read_only=True)
    site_name = serializers.CharField(source="site.name", read_only=True)
    coach_name = serializers.SerializerMethodField()
    overall_values_rating = serializers.IntegerField(read_only=True)

    class Meta:
        model = StudentValueAssessment
        fields = "__all__"
        read_only_fields = ["coach", "site"]

    def get_coach_name(self, obj):
        return obj.coach.get_full_name() or obj.coach.username

    def validate(self, attrs):
        for field in ["respect", "discipline", "teamwork", "responsibility", "sportsmanship"]:
            value = attrs.get(field)
            if value is not None and (value < 0 or value > 100):
                raise serializers.ValidationError({field: "Debe estar entre 0 y 100."})
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        student = validated_data["student"]
        if request and request.user.is_authenticated:
            validated_data["coach"] = request.user
        validated_data["site"] = student.site
        rating = round(
            (
                validated_data.get("respect", 50)
                + validated_data.get("discipline", 50)
                + validated_data.get("teamwork", 50)
                + validated_data.get("responsibility", 50)
                + validated_data.get("sportsmanship", 50)
            )
            / 5
        )
        validated_data["minutes_recommendation"] = value_minutes_recommendation(rating)
        assessment, _ = StudentValueAssessment.objects.update_or_create(
            student=student,
            assessment_month=validated_data["assessment_month"],
            defaults=validated_data,
        )
        return assessment

    def update(self, instance, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["coach"] = request.user
        validated_data["site"] = validated_data.get("student", instance.student).site
        rating = round(
            (
                validated_data.get("respect", instance.respect)
                + validated_data.get("discipline", instance.discipline)
                + validated_data.get("teamwork", instance.teamwork)
                + validated_data.get("responsibility", instance.responsibility)
                + validated_data.get("sportsmanship", instance.sportsmanship)
            )
            / 5
        )
        validated_data["minutes_recommendation"] = value_minutes_recommendation(rating)
        return super().update(instance, validated_data)


def value_minutes_recommendation(rating):
    if rating >= 90:
        return "Prioridad alta de minutos"
    if rating >= 80:
        return "Minutos constantes"
    if rating >= 70:
        return "Rotacion controlada"
    if rating >= 60:
        return "Minutos condicionados"
    return "Plan formativo antes de competir"

