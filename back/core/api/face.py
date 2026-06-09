from .common import *

class FaceAttendanceView(APIView):
    permission_classes = [IsOperationsOrCoachRole]

    def get(self, request):
        try:
            from deepface import DeepFace  # noqa: F401

            return Response({"deepface_available": True, "engine": "deepface"})
        except Exception as exc:
            return Response({"deepface_available": False, "engine": "mock", "detail": str(exc)})

    def post(self, request):
        session_id = request.data.get("session")
        session = AttendanceSession.objects.get(id=session_id)
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
        matched_student = None
        confidence = Decimal("0")
        engine = "mock"
        notes = "Demo local: seleccion manual o primer alumno del roster."

        if forced_student_id:
            matched_student = next((student for student in roster if student.id == int(forced_student_id)), None)
            confidence = Decimal("0.9900")
            notes = "Demo local: alumno forzado manualmente."
        elif image_data:
            try:
                from deepface import DeepFace

                engine = "deepface"
                header, _, payload = image_data.partition(",")
                raw = base64.b64decode(payload or header)
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as captured:
                    captured.write(raw)
                    captured_path = captured.name
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as mirrored:
                    mirrored_path = mirrored.name
                ImageOps.mirror(Image.open(captured_path)).save(mirrored_path, format="JPEG")

                best_distance = None
                best_student = None
                best_verified = False
                best_threshold = Decimal("0")
                best_orientation = "original"
                compared = 0
                skipped = []
                candidate_notes = []
                for student in roster:
                    reference_path = None
                    if student.photo:
                        reference_path = student.photo.path
                    elif student.photo_url:
                        try:
                            ref_file = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
                            ref_file.close()
                            urlretrieve(student.photo_url, ref_file.name)
                            reference_path = ref_file.name
                        except Exception as exc:
                            skipped.append(f"{student.full_name}: no se pudo leer photo_url ({exc})")
                            continue
                    if not reference_path:
                        continue
                    for orientation, probe_path in [("original", captured_path), ("espejada", mirrored_path)]:
                        try:
                            result = DeepFace.verify(
                                img1_path=probe_path,
                                img2_path=reference_path,
                                model_name="Facenet512",
                                enforce_detection=False,
                            )
                            compared += 1
                            distance = Decimal(str(result.get("distance", 1)))
                            threshold = Decimal(str(result.get("threshold", 0.3)))
                            verified = bool(result.get("verified"))
                            candidate_notes.append(
                                f"{student.full_name} {orientation}: distancia {distance:.4f}, umbral {threshold:.4f}, verified={verified}"
                            )
                            if best_distance is None or distance < best_distance:
                                best_distance = distance
                                best_student = student
                                best_verified = verified
                                best_threshold = threshold
                                best_orientation = orientation
                        except Exception as exc:
                            skipped.append(f"{student.full_name} {orientation}: comparacion fallida ({exc})")
                max_distance = Decimal(os.getenv("FACE_MATCH_MAX_DISTANCE", "0.55"))
                relaxed_threshold = max(best_threshold * Decimal("1.35"), max_distance) if best_threshold else max_distance
                if best_student and best_distance is not None and (best_verified or best_distance <= relaxed_threshold):
                    matched_student = best_student
                    confidence = max(Decimal("0"), Decimal("1") - best_distance).quantize(Decimal("0.0001"))
                    notes = (
                        f"DeepFace encontro coincidencia contra foto de perfil. Mejor candidato: "
                        f"{best_student.full_name} ({best_orientation}), distancia {best_distance:.4f}, "
                        f"umbral {best_threshold:.4f}, limite demo {relaxed_threshold:.4f}. Comparo {compared} imagenes."
                    )
                else:
                    notes = f"DeepFace no encontro coincidencia confiable. Comparo {compared} imagenes."
                    if best_student and best_distance is not None:
                        notes = (
                            f"{notes} Mejor candidato: {best_student.full_name} ({best_orientation}), "
                            f"distancia {best_distance:.4f}, umbral {best_threshold:.4f}."
                        )
                    if candidate_notes:
                        notes = f"{notes} Detalle: {' | '.join(candidate_notes[:4])}"
                    if skipped:
                        notes = f"{notes} Omitidos: {' | '.join(skipped[:3])}"
            except Exception as exc:
                engine = "mock"
                notes = f"DeepFace no disponible; fallback demo local sin reconocimiento real: {exc}"
        else:
            matched_student = roster[0]
            confidence = Decimal("0.6500")
            notes = "Demo local: no se recibio imagen, se uso primer alumno del roster."

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
                    "override_reason": "Pase de lista por reconocimiento facial demo.",
                    "captured_by": request.user,
                },
            )
        return Response(
            {
                "attempt": FaceRecognitionAttemptSerializer(attempt).data,
                "attendance": AttendanceRecordSerializer(attendance).data if attendance else None,
            }
        )

