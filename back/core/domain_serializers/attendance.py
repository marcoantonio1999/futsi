from .common import *

class AttendanceSessionSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)
    record_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = AttendanceSession
        fields = "__all__"
        read_only_fields = ["captured_by", "closed_at"]

    def create(self, validated_data):
        request = self.context.get("request")
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
        if student:
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

