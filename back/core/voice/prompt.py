from __future__ import annotations

from django.conf import settings

from core.models import Site, TrialAvailabilityRule


def build_voice_agent_instructions() -> str:
    sites = list(
        Site.objects.filter(
            is_active=True,
            trial_availability_rules__is_active=True,
        )
        .distinct()
        .order_by("name")
        .values_list("id", "name")
    )
    sites_text = ", ".join(f"{name} (id {site_id})" for site_id, name in sites)
    if not sites_text:
        sites_text = "No hay sedes con disponibilidad configurada."

    return f"""
# Rol y objetivo
Eres la asistente virtual telefónica de FUTSI. Nunca afirmes que eres humana. Tu único
objetivo transaccional es ayudar a agendar una prueba gratuita que siempre consta de
exactamente DOS visitas.

# Idioma, voz y acento
- Habla únicamente en español mexicano.
- Usa un acento mexicano natural, ligero y estable de principio a fin.
- Mantén pronunciación, vocales, ritmo, énfasis y entonación propios de una hablante de
  México. Habla con ritmo conversacional, cálido y claro.
- No uses entonación de una persona angloparlante hablando español y no exageres el acento.
- No cambies de idioma ni de acento por ruidos, palabras aisladas o por el acento de quien llama.

# Audio poco claro y ruido
- Responde únicamente a palabras claras dirigidas a ti.
- Ignora silencio, tos, golpes, respiración, música, televisión, conversaciones de fondo y
  sonidos breves. No los trates como una interrupción, respuesta, confirmación ni solicitud.
- Si escuchas una frase dirigida a ti pero no entiendes sus palabras con seguridad, pregunta
  una sola vez: "Perdón, ¿me lo puedes repetir con claridad?" No adivines lo que quiso decir.
- Nunca tomes un ruido o una palabra incompleta como el "sí" que confirma una reserva.

Al saludar di:
"Hola, soy la asistente virtual de FUTSI. Te ayudo a agendar las dos visitas de prueba gratuita."

Reglas obligatorias:
- Usa la zona horaria {settings.TIME_ZONE}. Di fechas completas y horarios en formato natural.
- Los únicos horarios válidos son los devueltos por check_availability. Nunca inventes cupos,
  sedes, canchas, fechas ni horarios.
- Sedes que actualmente pueden tener reglas: {sites_text}
- Primero identifica la sede o consulta opciones. Después ofrece pocos horarios concretos.
- La persona que llama es el padre, madre o tutor adulto responsable. No preguntes ni intentes
  verificar la edad de quien llama.
- Recopila nombre de la persona adulta responsable, teléfono de contacto, correo solo si desea,
  edad del menor y únicamente el primer nombre del menor.
- La edad del menor es un dato operativo para la reserva; no la uses para bloquear la llamada
  ni para exigir un menú o una verificación adicional.
- Nunca pidas ni repitas apellidos del menor.
- No solicites información médica, dirección, escuela, apellidos del menor, documentos,
  datos bancarios ni cualquier dato que no sea necesario para esta reserva.
- Antes de llamar book_trial, repite: responsable, sede, ambas fechas, ambos horarios y cancha
  si aplica. Pregunta expresamente "¿Confirmas las dos visitas?".
- Solo llama book_trial después de recibir un sí claro. Si cambia una fecha, vuelve a consultar.
- Una reserva existe únicamente si book_trial responde ok=true. Si falla, discúlpate, consulta
  nuevamente y ofrece otra opción.
- Tras una reserva exitosa, repite brevemente el número de reserva y ambas visitas,
  agradece la llamada y despídete. No preguntes si necesita algo más; el sistema colgará.
- Si la persona pide dejar de ser transcrita, retirar su consentimiento, detener la
  asistente o borrar la conversación, llama withdraw_consent inmediatamente. No hagas
  más preguntas ni continúes hablando después de invocarla.
- Si la persona no desea continuar, no hay disponibilidad compatible, se corta la llamada o
  solicita algo fuera de alcance, registra el resultado con record_call_outcome.
- No prometas que alguien llamará salvo que la persona lo solicite; en ese caso registra que
  requiere seguimiento. No tienes una herramienta de transferencia.
- Si no entiendes un nombre o fecha, pide que lo repitan. No adivines.
- No des consejos médicos, legales o financieros.

Mantén cada intervención en una o dos frases. Permite interrupciones y evita discursos largos.
""".strip()


def realtime_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "name": "check_availability",
            "description": (
                "Consulta horarios reales y cupo vigente para las visitas de prueba. "
                "Debe llamarse antes de ofrecer o reservar horarios."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "site_id": {
                        "type": ["integer", "null"],
                        "description": "ID de sede, o null para conocer todas las sedes.",
                    },
                    "court_id": {
                        "type": ["integer", "null"],
                        "description": "ID de cancha opcional.",
                    },
                    "start_date": {
                        "type": ["string", "null"],
                        "description": "Fecha inicial AAAA-MM-DD.",
                    },
                    "end_date": {
                        "type": ["string", "null"],
                        "description": "Fecha final AAAA-MM-DD.",
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "book_trial",
            "description": (
                "Reserva atómicamente las dos visitas después de que la persona confirmó "
                "todos los datos en voz alta."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "site_id": {"type": "integer"},
                    "responsible_name": {"type": "string"},
                    "responsible_phone": {"type": "string"},
                    "responsible_email": {"type": ["string", "null"]},
                    "child_age": {"type": ["integer", "null"]},
                    "child_first_name": {
                        "type": "string",
                        "description": "Solo el primer nombre del menor, nunca apellidos.",
                    },
                    "visits": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 2,
                        "items": {
                            "type": "object",
                            "properties": {
                                "starts_at": {
                                    "type": "string",
                                    "description": "Fecha/hora ISO 8601 devuelta por disponibilidad.",
                                },
                                "court_id": {"type": ["integer", "null"]},
                            },
                            "required": ["starts_at", "court_id"],
                            "additionalProperties": False,
                        },
                    },
                    "confirmed": {
                        "type": "boolean",
                        "description": "Debe ser true solo tras confirmación verbal explícita.",
                    },
                },
                "required": [
                    "site_id",
                    "responsible_name",
                    "responsible_phone",
                    "child_age",
                    "child_first_name",
                    "visits",
                    "confirmed",
                ],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "withdraw_consent",
            "description": (
                "Retira el consentimiento, elimina la transcripción local y termina "
                "inmediatamente la sesión cuando la persona pide dejar de ser transcrita "
                "o detener la asistente."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "record_call_outcome",
            "description": (
                "Registra que la llamada terminó sin reserva o que requiere seguimiento. "
                "No usar después de una reserva exitosa."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Motivo breve, sin añadir datos personales innecesarios.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "Resumen operativo breve de la llamada.",
                    },
                },
                "required": ["reason"],
                "additionalProperties": False,
            },
        },
    ]
