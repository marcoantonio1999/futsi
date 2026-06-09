from .common import *
from .money import charge_balance

class TournamentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tournament
        fields = "__all__"


class TeamSerializer(serializers.ModelSerializer):
    tournament_name = serializers.CharField(source="tournament.name", read_only=True)
    site = serializers.IntegerField(source="tournament.site_id", read_only=True)
    site_name = serializers.CharField(source="tournament.site.name", read_only=True)
    player_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Team
        fields = "__all__"


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
        return super().create(validated_data)

    def update(self, instance, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["updated_by"] = request.user
        return super().update(instance, validated_data)


class StudentAssessmentSerializer(serializers.ModelSerializer):
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

