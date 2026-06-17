from .common import *
from core.services.face_insight import (
    build_student_database,
    data_url_to_bgr,
    detect_embeddings,
    match_embedding,
    mirror_bgr,
    resolve_providers,
)


class FaceAttendanceView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request):
        providers = request.query_params.get("providers", os.getenv("FACE_PROVIDERS", "auto"))
        try:
            import onnxruntime as ort

            return Response(
                {
                    "available": True,
                    "engine": "insightface",
                    "model": os.getenv("FACE_MODEL_NAME", "buffalo_l"),
                    "requested_providers": providers,
                    "resolved_providers": resolve_providers(providers.split(",")),
                    "available_providers": ort.get_available_providers(),
                }
            )
        except Exception as exc:
            return Response(
                {
                    "available": False,
                    "engine": "insightface",
                    "model": os.getenv("FACE_MODEL_NAME", "buffalo_l"),
                    "detail": str(exc),
                }
            )

    def post(self, request):
        session_id = request.data.get("session")
        try:
            session = AttendanceSession.objects.get(id=session_id)
        except AttendanceSession.DoesNotExist:
            return Response({"detail": "La sesion no existe."}, status=status.HTTP_404_NOT_FOUND)

        if session.closed_at:
            return Response({"detail": "La sesion ya esta cerrada."}, status=status.HTTP_400_BAD_REQUEST)

        roster = Student.objects.filter(site=session.site, status__in=["trial", "active", "paused", "injured"])
        if session.group_name:
            roster = roster.filter(group_name=session.group_name)
        roster = list(roster)
        if not roster:
            return Response({"detail": "No hay alumnos en el grupo para comparar."}, status=status.HTTP_400_BAD_REQUEST)

        forced_student_id = request.data.get("student")
        image_data = request.data.get("image", "")
        providers = request.data.get("providers") or os.getenv("FACE_PROVIDERS", "auto")
        threshold = float(request.data.get("threshold") or os.getenv("FACE_MATCH_THRESHOLD", "0.45"))
        min_margin = float(request.data.get("min_margin") or os.getenv("FACE_MATCH_MIN_MARGIN", "0.03"))

        matched_student = None
        confidence = Decimal("0")
        engine = "insightface"
        notes = "No se recibio imagen para reconocimiento facial."

        if forced_student_id:
            matched_student = next((student for student in roster if student.id == int(forced_student_id)), None)
            if not matched_student:
                return Response({"detail": "El alumno seleccionado no pertenece a esta lista."}, status=status.HTTP_400_BAD_REQUEST)
            confidence = Decimal("0.9900")
            notes = "Alumno forzado manualmente desde la pantalla de asistencia."
        elif image_data:
            try:
                enrolled_students, reference_matrix, skipped = build_student_database(roster, providers_key=providers)
                compared = len(enrolled_students)
                best_match = None
                best_orientation = "original"
                detected = 0

                captured = data_url_to_bgr(image_data)
                for orientation, candidate in [("original", captured), ("espejada", mirror_bgr(captured))]:
                    for face in detect_embeddings(candidate, providers_key=providers):
                        detected += 1
                        match = match_embedding(
                            face.embedding,
                            enrolled_students,
                            reference_matrix,
                            threshold=threshold,
                            min_margin=min_margin,
                        )
                        if best_match is None or match.similarity > best_match.similarity:
                            best_match = match
                            best_orientation = orientation

                if best_match and best_match.matched:
                    matched_student = best_match.student
                    confidence = Decimal(str(best_match.similarity)).quantize(Decimal("0.0001"))
                    notes = (
                        "InsightFace encontro coincidencia contra foto de perfil. "
                        f"Orientacion: {best_orientation}. Similitud {best_match.similarity:.4f}, "
                        f"margen {best_match.margin:.4f}. Comparo {compared} alumnos."
                    )
                else:
                    notes = f"InsightFace no encontro coincidencia confiable. Detecto {detected} caras y comparo {compared} alumnos."
                    if best_match:
                        notes = f"{notes} Mejor similitud {best_match.similarity:.4f}, margen {best_match.margin:.4f}."
                    if skipped:
                        notes = f"{notes} Omitidos: {' | '.join(skipped[:4])}"
            except Exception as exc:
                engine = "insightface-error"
                notes = f"InsightFace no pudo procesar la imagen: {exc}"

        attempt = FaceRecognitionAttempt.objects.create(
            session=session,
            student=matched_student,
            captured_by=request.user,
            matched=bool(matched_student),
            confidence=confidence,
            engine=engine,
            notes=notes,
        )

        attendance = None
        if matched_student:
            attendance, _ = AttendanceRecord.objects.update_or_create(
                session=session,
                student=matched_student,
                defaults={
                    "status": "present",
                    "had_debt_at_capture": matched_student.charges.filter(status__in=["pending", "partial"]).exists(),
                    "override_reason": "Pase de lista por reconocimiento facial.",
                    "captured_by": request.user,
                },
            )
        return Response(
            {
                "attempt": FaceRecognitionAttemptSerializer(attempt).data,
                "attendance": AttendanceRecordSerializer(attendance).data if attendance else None,
            }
        )
