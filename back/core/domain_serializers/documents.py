from .common import *

class InvoiceSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    guardian_name = serializers.CharField(source="guardian.full_name", read_only=True)
    coach_name = serializers.SerializerMethodField()
    expense_description = serializers.CharField(source="expense.description", read_only=True)
    charge_concept = serializers.CharField(source="charge.concept", read_only=True)
    issued_by_username = serializers.CharField(source="issued_by.username", read_only=True)
    pdf_url = serializers.SerializerMethodField()
    xml_url = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = "__all__"
        read_only_fields = ["uuid", "xml_content", "pdf_file", "issued_by", "issued_at", "created_at", "updated_at"]

    def get_coach_name(self, obj):
        return obj.coach.get_full_name() or obj.coach.username if obj.coach else ""

    def get_pdf_url(self, obj):
        return f"/api/invoices/{obj.id}/pdf/"

    def get_xml_url(self, obj):
        return f"/api/invoices/{obj.id}/xml/"


class HistoricalImportRowSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)

    class Meta:
        model = HistoricalImportRow
        fields = "__all__"
        read_only_fields = ["historical_import", "status", "target_table", "target_id", "error", "created_at", "updated_at"]


class HistoricalImportSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source="uploaded_by.username", read_only=True)
    committed_by_username = serializers.CharField(source="committed_by.username", read_only=True)
    row_count = serializers.IntegerField(read_only=True)
    rows = HistoricalImportRowSerializer(many=True, read_only=True)

    class Meta:
        model = HistoricalImport
        fields = "__all__"
        read_only_fields = [
            "status",
            "uploaded_by",
            "committed_by",
            "committed_at",
            "summary",
            "created_at",
            "updated_at",
        ]


class FaceRecognitionAttemptSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)

    class Meta:
        model = FaceRecognitionAttempt
        fields = "__all__"


class DailyClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyClosure
        fields = "__all__"
        read_only_fields = ["closed_by", "closed_at", "created_at", "updated_at"]


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at"]
