from .common import *
from django.db import transaction
from django.db.models.deletion import ProtectedError, RestrictedError
from django.db.models import Prefetch, Exists, OuterRef, CharField, Q
from django.db.models.functions import Cast
from pathlib import Path
from rest_framework.exceptions import NotFound, ValidationError
from django.shortcuts import get_object_or_404
from core.services.student_deletion import preview as student_deletion_preview, permanently_delete, cleanup_files
from core.services import guardian_deletion, tournament_deletion, site_deletion, site_associations
from core.services.student_photos import save_student, PHOTO_BUCKET, StudentPhotoUnavailable
from core.services.supabase_storage import download_private_file, parse_storage_uri

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related("primary_site", "guardian_profile").all()
    serializer_class = UserSerializer
    permission_classes = [IsAdminRole]


class SiteViewSet(viewsets.ModelViewSet):
    queryset = Site.objects.annotate(student_count=Count("students")).all()
    serializer_class = SiteSerializer
    permission_classes = [IsAdminForWrites]

    def destroy(self, request, *args, **kwargs):
        return Response(site_deletion.permanently_delete(self.get_object(), request.user, request.data))

    @action(detail=True, methods=["get"], url_path="deletion-preview", permission_classes=[IsAdminRole])
    def deletion_preview(self, request, pk=None):
        return Response(site_deletion.preview(self.get_object(), request.user))

    @action(detail=True, methods=["get"], url_path="associations", permission_classes=[IsAdminRole])
    def associations(self, request, pk=None):
        return Response(site_associations.summary(self.get_object()))

    def get_queryset(self):
        queryset = super().get_queryset()
        from core.veronica_access import is_court_communications_only
        if is_court_communications_only(self.request.user):
            return queryset.filter(pk=self.request.user.primary_site_id) if self.request.user.primary_site_id else queryset.none()
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            return queryset.filter(id=self.request.user.primary_site_id)
        if self.request.user.role == "guardian":
            return queryset.filter(students__guardian__user=self.request.user).distinct()
        return queryset


class CourtViewSet(viewsets.ModelViewSet):
    queryset = Court.objects.all()
    serializer_class = CourtSerializer
    permission_classes = [IsAdminForWrites]


class GuardianViewSet(viewsets.ModelViewSet):
    queryset = Guardian.objects.select_related("user").all()
    serializer_class = GuardianSerializer
    permission_classes = [IsOperationsOrCashierRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role in {"site_coordinator", "cashier"}:
            if not self.request.user.primary_site_id:
                return queryset.none()
            # A tutor created in step one must remain selectable after a refresh,
            # even before their first child has been registered.
            created_here = AuditLog.objects.filter(
                action="guardian_created", table_name="guardians",
                record_id=Cast(OuterRef("pk"), CharField()),
                metadata__site_id=self.request.user.primary_site_id,
            )
            queryset = queryset.annotate(created_here=Exists(created_here)).filter(
                Q(students__site_id=self.request.user.primary_site_id)
                | Q(students__isnull=True, created_here=True)
            )
        return queryset.distinct()

    def perform_create(self, serializer):
        if self.request.user.role not in {"site_coordinator", "cashier"}:
            serializer.save()
            return
        if not self.request.user.primary_site_id:
            raise PermissionDenied("Necesitas una sede asignada para registrar tutores.")
        with transaction.atomic():
            guardian = serializer.save()
            AuditLog.objects.create(
                actor=self.request.user, action="guardian_created", table_name="guardians",
                record_id=str(guardian.pk), metadata={"site_id": self.request.user.primary_site_id},
            )

    @action(detail=True, methods=["get"], url_path="deletion-preview")
    def deletion_preview(self, request, pk=None):
        return Response(guardian_deletion.preview(self.get_object(), request.user))

    def destroy(self, request, *args, **kwargs):
        return Response(guardian_deletion.permanently_delete(self.get_object(), request.user, request.data))

    @action(detail=False, methods=["post"], url_path="deletion-cleanup")
    def deletion_cleanup(self, request):
        deletion_id = request.data.get("deletion_id")
        if not isinstance(deletion_id, int) or isinstance(deletion_id, bool):
            raise ValidationError("La referencia de eliminación no es válida.")
        audits = AuditLog.objects.filter(action="guardian_deleted")
        if request.user.role in {"cashier", "site_coordinator"}:
            if not request.user.primary_site_id:
                raise PermissionDenied("Necesitas una sede asignada.")
            audits = audits.filter(metadata__site_id=request.user.primary_site_id)
        with transaction.atomic():
            audit = get_object_or_404(audits.select_for_update(), pk=deletion_id)
            result = cleanup_files(audit)
        return Response(result)


class StudentViewSet(viewsets.ModelViewSet):
    queryset = (
        Student.objects.select_related("site", "guardian")
        .prefetch_related(
            Prefetch(
                "charges",
                queryset=Charge.objects.filter(status__in=["pending", "partial"])
                .only("id", "student_id", "amount")
                .prefetch_related(
                    Prefetch("payments", queryset=Payment.objects.filter(status__in=["registered", "reconciled"]).only("id", "charge_id", "amount"), to_attr="confirmed_payments"),
                    Prefetch("discounts", queryset=Discount.objects.filter(status="approved").only("id", "charge_id", "amount"), to_attr="approved_discounts"),
                ),
                to_attr="open_charges",
            ),
            Prefetch(
                "discounts",
                queryset=Discount.objects.filter(status="approved")
                .only("id", "student_id", "charge_id", "reason", "amount", "approved_at", "created_at")
                .order_by("-approved_at", "-created_at"),
                to_attr="approved_student_discounts",
            ),
        )
        .all()
    )
    serializer_class = StudentSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_permissions(self):
        if self.action in {"deletion_preview", "deletion_cleanup"}:
            return [IsOperationsOrCashierRole()]
        if self.request.user.is_authenticated and self.request.user.role in {"adult_player", "adult_representative"}:
            return [IsOperationsRole()]
        if self.request.user.is_authenticated and self.request.user.role in {"guardian", "coach"} and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        if self.request.user.is_authenticated and self.request.user.role == "cashier" and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsOrCashierRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            return queryset.filter(guardian__user=self.request.user)
        if self.request.user.role in {"cashier", "site_coordinator"}:
            return queryset.filter(site=self.request.user.primary_site)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(group_name=self.request.user.coach_group_name)
            return queryset
        return queryset.distinct()

    def perform_create(self, serializer):
        self._validate_academy_scope(serializer.validated_data)
        save_student(serializer)

    def perform_update(self, serializer):
        self._validate_academy_scope(serializer.validated_data, serializer.instance)
        save_student(serializer)

    @action(detail=True, methods=["get"], url_path="deletion-preview")
    def deletion_preview(self, request, pk=None):
        student = self.get_object()
        self._validate_academy_scope({"site": student.site}, student)
        return Response(student_deletion_preview(student, request.user))

    def destroy(self, request, *args, **kwargs):
        student = self.get_object()
        self._validate_academy_scope({"site": student.site}, student)
        return Response(permanently_delete(student, request.user, request.data))

    @action(detail=False, methods=["post"], url_path="deletion-cleanup")
    def deletion_cleanup(self, request):
        deletion_id = request.data.get("deletion_id")
        if not isinstance(deletion_id, int) or isinstance(deletion_id, bool):
            return Response({"detail": "La referencia de eliminación no es válida."}, status=400)
        audits = AuditLog.objects.filter(action="student_deleted")
        if request.user.role in {"cashier", "site_coordinator"}:
            audits = audits.filter(metadata__site_id=request.user.primary_site_id)
        audit = get_object_or_404(audits, pk=deletion_id)
        with transaction.atomic():
            audit = AuditLog.objects.select_for_update().get(pk=audit.pk)
            result = cleanup_files(audit)
        return Response(result)

    @action(detail=True, methods=["get"], url_path="photo-content")
    def photo_content(self, request, pk=None):
        student = self.get_object()
        stored = parse_storage_uri(student.photo_url or "")
        if not stored or stored[0] != PHOTO_BUCKET:
            raise NotFound("El alumno no tiene una foto privada disponible.")
        local_path = None
        try:
            local_path = download_private_file(*stored)
            response = HttpResponse(Path(local_path).read_bytes(), content_type="image/jpeg")
            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"
            return response
        except Exception as exc:
            raise StudentPhotoUnavailable("No se pudo cargar la foto del alumno.") from exc
        finally:
            if local_path:
                Path(local_path).unlink(missing_ok=True)

    def _validate_academy_scope(self, data, instance=None):
        if self.request.user.role not in {"cashier", "site_coordinator"}:
            return
        site = data.get("site") or getattr(instance, "site", None)
        guardian = data.get("guardian") or getattr(instance, "guardian", None)
        if not self.request.user.primary_site_id or not site or site.id != self.request.user.primary_site_id:
            raise PermissionDenied("Solo puedes registrar o editar alumnos de tu sede.")
        if guardian and guardian.students.exists() and not guardian.students.filter(site_id=self.request.user.primary_site_id).exists():
            raise PermissionDenied("Solo puedes asignar tutores vinculados a tu sede.")


class TournamentViewSet(viewsets.ModelViewSet):
    queryset = Tournament.objects.select_related("site").all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAdminOrSiteCoordinatorRole]

    def get_permissions(self):
        if self.action in {"deletion_preview", "deletion_cleanup", "destroy"}:
            if self.request.user.is_authenticated and self.request.user.role == "cashier":
                return [IsOperationsOrCashierRole()]
            return [IsAdminOrSiteCoordinatorRole()]
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        if self.request.user.is_authenticated and self.request.user.role == "cashier":
            return [IsOperationsOrCashierRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        site = self.request.query_params.get("site")
        if site:
            queryset = queryset.filter(site_id=site)
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            queryset = queryset.filter(site_id=self.request.user.primary_site_id)
        return queryset.distinct()

    def perform_create(self, serializer):
        ensure_cashier_primary_site(self.request.user, serializer.validated_data["site"].id)
        serializer.save()

    def deletion_target(self):
        tournament = self.get_object()
        if self.request.user.role in {"cashier", "site_coordinator"}:
            if not self.request.user.primary_site_id or tournament.site_id != self.request.user.primary_site_id:
                raise PermissionDenied("Solo puedes eliminar torneos de tu sede asignada.")
        return tournament

    @action(detail=True, methods=["get"], url_path="deletion-preview")
    def deletion_preview(self, request, pk=None):
        return Response(tournament_deletion.preview(self.deletion_target(), request.user))

    def destroy(self, request, *args, **kwargs):
        return Response(tournament_deletion.permanently_delete(self.deletion_target(), request.user, request.data))

    @action(detail=False, methods=["post"], url_path="deletion-cleanup")
    def deletion_cleanup(self, request):
        deletion_id = request.data.get("deletion_id")
        if not isinstance(deletion_id, int) or isinstance(deletion_id, bool):
            raise ValidationError("La referencia de eliminación no es válida.")
        audits = AuditLog.objects.filter(action="tournament_deleted")
        if request.user.role in {"cashier", "site_coordinator"}:
            if not request.user.primary_site_id:
                raise PermissionDenied("Necesitas una sede asignada.")
            audits = audits.filter(metadata__site_id=request.user.primary_site_id)
        with transaction.atomic():
            audit = get_object_or_404(audits.select_for_update(), pk=deletion_id)
            result = cleanup_files(audit)
        return Response(result)

    def perform_update(self, serializer):
        site = serializer.validated_data.get("site") or serializer.instance.site
        ensure_cashier_primary_site(self.request.user, site.id)
        serializer.save()


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related("tournament", "tournament__site").annotate(player_count=Count("players")).all()
    serializer_class = TeamSerializer
    permission_classes = [IsAdminOrSiteCoordinatorRole]

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        if self.request.user.is_authenticated and self.request.user.role == "cashier":
            return [IsOperationsOrCashierRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(representative_user=self.request.user)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(players__user=self.request.user)
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            queryset = queryset.filter(tournament__site=self.request.user.primary_site)
        return queryset

    def perform_create(self, serializer):
        ensure_cashier_primary_site(self.request.user, serializer.validated_data["tournament"].site_id)
        serializer.save()

    def perform_update(self, serializer):
        tournament = serializer.validated_data.get("tournament") or serializer.instance.tournament
        ensure_cashier_primary_site(self.request.user, tournament.site_id)
        serializer.save()


class StudentTournamentRegistrationViewSet(viewsets.ModelViewSet):
    queryset = StudentTournamentRegistration.objects.select_related("tournament", "tournament__site", "student", "team", "registered_by").all()
    serializer_class = StudentTournamentRegistrationSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            if self.request.user.is_authenticated and self.request.user.role == "cashier":
                return [IsOperationsOrCashierRole()]
            return [IsAdminOrSiteCoordinatorRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        tournament = self.request.query_params.get("tournament")
        student = self.request.query_params.get("student")
        site = self.request.query_params.get("site")
        if tournament:
            queryset = queryset.filter(tournament_id=tournament)
        if student:
            queryset = queryset.filter(student_id=student)
        if site:
            queryset = queryset.filter(tournament__site_id=site)
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role in {"coach", "cashier", "site_coordinator"}:
            queryset = queryset.filter(tournament__site=self.request.user.primary_site)
        return queryset.distinct()

    def perform_create(self, serializer):
        self._validate_academy_scope(serializer.validated_data)
        serializer.save()

    def perform_update(self, serializer):
        self._validate_academy_scope(serializer.validated_data, serializer.instance)
        serializer.save()

    def _validate_academy_scope(self, data, instance=None):
        if self.request.user.role not in {"cashier", "site_coordinator"}:
            return
        if not self.request.user.primary_site_id:
            raise PermissionDenied("Necesitas una sede asignada para gestionar inscripciones.")
        tournament = data.get("tournament") or getattr(instance, "tournament", None)
        student = data.get("student") or getattr(instance, "student", None)
        team = data.get("team") if "team" in data else getattr(instance, "team", None)
        if tournament and tournament.site_id != self.request.user.primary_site_id:
            raise PermissionDenied("Solo puedes gestionar inscripciones de tu sede.")
        ensure_cashier_primary_site(self.request.user, tournament.site_id if tournament else None)
        if student:
            ensure_cashier_primary_site(self.request.user, student.site_id)
        if team:
            ensure_cashier_primary_site(self.request.user, team.tournament.site_id)


class PlayerViewSet(viewsets.ModelViewSet):
    queryset = Player.objects.select_related("team", "team__tournament", "team__tournament__site").all()
    serializer_class = PlayerSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]
    list_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "user_id",
        "team_id",
        "full_name",
        "phone",
        "email",
        "jersey_number",
        "photo",
        "photo_url",
        "identity_document",
        "waiver_document",
        "is_active",
        "team__id",
        "team__name",
        "team__tournament_id",
        "team__tournament__id",
        "team__tournament__name",
        "team__tournament__site_id",
        "team__tournament__site__id",
        "team__tournament__site__name",
    )

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        return [IsAdminOrSiteCoordinatorRole()]

    def get_queryset(self):
        queryset = super().get_queryset()
        team = self.request.query_params.get("team")
        site = self.request.query_params.get("site")
        if team:
            queryset = queryset.filter(team_id=team)
        if site:
            queryset = queryset.filter(team__tournament__site_id=site)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(user=self.request.user)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(team__representative_user=self.request.user)
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            queryset = queryset.filter(team__tournament__site_id=self.request.user.primary_site_id)
        if getattr(self, "action", None) == "list":
            queryset = queryset.only(*self.list_only_fields)
        return queryset


class PlayerAttendanceRecordViewSet(viewsets.ModelViewSet):
    queryset = PlayerAttendanceRecord.objects.select_related("session", "player", "player__team", "captured_by").all()
    serializer_class = PlayerAttendanceRecordSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        session = self.request.query_params.get("session")
        team = self.request.query_params.get("team")
        if session:
            queryset = queryset.filter(session_id=session)
        if team:
            queryset = queryset.filter(player__team_id=team)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(player__user=self.request.user)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(player__team__representative_user=self.request.user)
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            queryset = queryset.filter(player__team__tournament__site_id=self.request.user.primary_site_id)
        return queryset

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        return [IsOperationsCashierOrCoachRole()]


class RoundViewSet(viewsets.ModelViewSet):
    queryset = Round.objects.select_related("tournament").all()
    serializer_class = RoundSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        return [IsAdminOrSiteCoordinatorRole()]

    def get_queryset(self):
        queryset = super().get_queryset()
        tournament = self.request.query_params.get("tournament")
        if tournament:
            queryset = queryset.filter(tournament_id=tournament)
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            queryset = queryset.filter(tournament__site_id=self.request.user.primary_site_id)
        return queryset.distinct()

