"""Business-approved knowledge for the FUTSI WhatsApp assistant.

The academy and tournament entries come from the FAQ workbook supplied by the
business on 2026-08-19. Answers may be phrased naturally, but their factual
meaning must not be expanded beyond what is recorded here.
"""


FAQ_ENTRIES = (
    # Scheduling details already confirmed for the FUTSI trial-booking flow.
    {
        "key": "trial_overview",
        "category": "Prueba gratuita",
        "question": "¿En qué consiste la prueba gratuita?",
        "answer": (
            "La prueba gratuita incluye dos visitas a la cancha para que el alumno "
            "conozca la dinámica antes de tomar una decisión."
        ),
    },
    {
        "key": "trial_items",
        "category": "Prueba gratuita",
        "question": "¿Qué debemos llevar?",
        "answer": (
            "Recomendamos ropa deportiva cómoda, calzado deportivo y una botella "
            "de agua."
        ),
    },
    {
        "key": "trial_arrival",
        "category": "Prueba gratuita",
        "question": "¿Con cuánto tiempo debemos llegar?",
        "answer": "Recomendamos llegar 10 minutos antes del horario reservado.",
    },
    {
        "key": "trial_adult",
        "category": "Prueba gratuita",
        "question": "¿Debe acompañarlo un adulto?",
        "answer": (
            "Sí. Pedimos que el niño o la niña llegue acompañado por su mamá, papá "
            "o una persona responsable."
        ),
    },
    {
        "key": "trial_availability",
        "category": "Prueba gratuita",
        "question": "¿Cómo consulto sedes y horarios disponibles?",
        "answer": (
            "Escribe AGENDAR y te mostraremos únicamente las sedes y los horarios "
            "que estén disponibles en ese momento."
        ),
    },
    {
        "key": "trial_cost",
        "category": "Prueba gratuita",
        "question": "¿La prueba tiene costo?",
        "answer": "No, las dos visitas de la prueba son gratuitas.",
    },
    # Academia — supplied in “Preguntas Frecuentes WhatsApp B_POWER - Chatbol”.
    {
        "key": "academy_ages",
        "category": "Academia",
        "question": "¿Qué edades reciben?",
        "answer": (
            "Tenemos categorías para niños y niñas de 4 a 14 años. Pide la edad "
            "del alumno para orientar a la familia hacia el grupo correspondiente."
        ),
    },
    {
        "key": "academy_schedule",
        "category": "Academia",
        "question": "¿Qué días y horarios entrenan?",
        "answer": (
            "Los horarios dependen de la edad y categoría. Pide el año de nacimiento "
            "para compartir las opciones disponibles. Normalmente entrenan lunes y "
            "miércoles o martes y jueves por la tarde."
        ),
    },
    {
        "key": "academy_location",
        "category": "Academia",
        "question": "¿Dónde están ubicados?",
        "answer": (
            "Los entrenamientos son en Power Soccer Academy. Se puede ofrecer "
            "la ubicación exacta y los datos para llegar."
        ),
    },
    {
        "key": "academy_price",
        "category": "Academia",
        "question": "¿Cuánto cuesta la academia?",
        "answer": (
            "El precio depende de la forma de pago y de si aplica alguna promoción. "
            "Invita a la familia a tomar una clase muestra gratis y coméntale que el "
            "equipo puede explicarle personalmente las opciones disponibles."
        ),
        "requires_human": True,
    },
    {
        "key": "academy_trial",
        "category": "Academia",
        "question": "¿Puedo llevarlo a una clase de prueba?",
        "answer": (
            "Sí. Invita a la familia a conocer B POWER ACADEMY, basada en la "
            "metodología de REAL BETIS ACADEMY, y a agendar una prueba para conocer "
            "a sus entrenadores, compañeros y la metodología."
        ),
    },
    {
        "key": "academy_beginner",
        "category": "Academia",
        "question": "Mi hijo nunca ha jugado fútbol, ¿puede entrar?",
        "answer": (
            "Sí. Recibimos desde principiantes hasta jugadores con experiencia. "
            "Buscamos que cada niño aprenda a su ritmo, gane confianza y disfrute el fútbol."
        ),
    },
    {
        "key": "academy_girls",
        "category": "Academia",
        "question": "¿También aceptan niñas?",
        "answer": (
            "Sí. Hay equipos femeniles para niñas pequeñas, medianas y grandes, "
            "desde los 4 hasta los 16 años."
        ),
    },
    {
        "key": "academy_training",
        "category": "Academia",
        "question": "¿Qué enseñan en los entrenamientos?",
        "answer": (
            "Se trabaja técnica, coordinación, toma de decisiones y juego en equipo, "
            "además de valores como disciplina, resiliencia y compañerismo. Aprender "
            "y divertirse son muy importantes."
        ),
    },
    {
        "key": "academy_matches",
        "category": "Academia",
        "question": "¿Juegan partidos o torneos?",
        "answer": (
            "Sí. Buscamos que los jugadores apliquen lo aprendido en situaciones "
            "reales de juego y competencias adecuadas para su categoría."
        ),
    },
    {
        "key": "academy_enrollment",
        "category": "Academia",
        "question": "¿Cómo puedo inscribir a mi hijo?",
        "answer": (
            "Pide el nombre del alumno y ayúdale a agendar una clase muestra sin "
            "compromiso. En la ventanilla le apoyarán con el proceso de inscripción."
        ),
    },
    {
        "key": "academy_betis",
        "category": "Academia",
        "question": "¿Siguen siendo del Betis?",
        "answer": (
            "Ahora somos B POWER ACADEMY. Nos basamos en la metodología de REAL "
            "BETIS ACADEMY para incorporar lo mejor de esa experiencia en esta nueva etapa."
        ),
    },
    {
        "key": "academy_high_performance",
        "category": "Academia",
        "question": "¿Tienen alto rendimiento?",
        "answer": (
            "En algunas categorías sí. Invita a la familia a una clase muestra para "
            "que el equipo explore cuál es la mejor opción para el alumno."
        ),
        "requires_human": True,
    },
    {
        "key": "academy_adults",
        "category": "Academia",
        "question": "¿Tienen clases de adultos?",
        "answer": (
            "Sí, hay clases para adultos en varias sedes. Pide sus datos para que el "
            "equipo le comparta la información correspondiente."
        ),
        "requires_human": True,
    },
    # Torneos — supplied in the same business workbook.
    {
        "key": "tournaments_types",
        "category": "Torneos",
        "question": "¿Qué torneos tienen para adultos?",
        "answer": (
            "Hay torneos para adultos entre semana y los fines de semana, por la "
            "mañana, tarde y noche, con opciones varoniles y femeniles. Pregunta cuál busca."
        ),
    },
    {
        "key": "tournaments_days",
        "category": "Torneos",
        "question": "¿Qué días se juega?",
        "answer": (
            "En varonil hay Liga Premier de lunes a jueves, Liga Brasileña los viernes, "
            "Liga Española los sábados por la mañana, otra liga el sábado por la tarde "
            "y otra el domingo por la tarde. En femenil hay liga los lunes por la noche "
            "y ocasionalmente los martes. Pregunta qué día le acomoda mejor."
        ),
    },
    {
        "key": "tournaments_hours",
        "category": "Torneos",
        "question": "¿A qué hora son los partidos?",
        "answer": (
            "En varonil, entre semana los horarios van aproximadamente de 8:00 a "
            "10:50 pm; los fines de semana hay opciones por la mañana y por la tarde. "
            "En femenil se juega los lunes por la noche y ocasionalmente los martes."
        ),
    },
    {
        "key": "tournaments_location",
        "category": "Torneos",
        "question": "¿Dónde se juegan los partidos?",
        "answer": (
            "Los partidos se juegan en la cancha de pasto sintético de Power Soccer "
            "Academy. Se puede ofrecer la ubicación exacta de las canchas."
        ),
    },
    {
        "key": "tournaments_price",
        "category": "Torneos",
        "question": "¿Cuánto cuesta inscribir un equipo?",
        "answer": (
            "El equipo puede compartir la inscripción, arbitraje y costos según la "
            "opción. Pregunta si busca torneo varonil o femenil y qué día quiere jugar."
        ),
        "requires_human": True,
    },
    {
        "key": "tournaments_players",
        "category": "Torneos",
        "question": "¿Cuántos jugadores necesito para inscribir un equipo?",
        "answer": (
            "El mínimo es de 8 y el máximo de 16 jugadores o jugadoras por equipo. "
            "Se registran directamente en la ventanilla de la cancha."
        ),
    },
    {
        "key": "tournaments_without_team",
        "category": "Torneos",
        "question": "¿Puedo inscribirme si no tengo equipo?",
        "answer": (
            "Sí. Pide sus datos y posición; si algún equipo busca jugador o jugadora, "
            "el personal puede intentar ponerles en contacto."
        ),
        "requires_human": True,
    },
    {
        "key": "tournaments_duration",
        "category": "Torneos",
        "question": "¿Cuánto dura cada partido?",
        "answer": (
            "La duración exacta todavía no fue proporcionada. Ofrece que una persona "
            "del equipo confirme el dato y comparta el reglamento completo."
        ),
        "requires_human": True,
    },
    {
        "key": "tournaments_prizes",
        "category": "Torneos",
        "question": "¿Hay premios?",
        "answer": (
            "Sí. El torneo tiene fase competitiva y premiación. Puede variar, pero por "
            "lo regular incluye trofeo, fotos del equipo y uniformes para los campeones."
        ),
    },
    {
        "key": "tournaments_enrollment",
        "category": "Torneos",
        "question": "¿Cómo inscribo a mi equipo?",
        "answer": (
            "Pide nombre y teléfono para conseguir un partido de muestra. Pregunta si "
            "busca varonil o femenil y qué día quiere jugar; el equipo le contactará "
            "para ofrecerle un horario."
        ),
        "requires_human": True,
    },
    {
        "key": "tournaments_format",
        "category": "Torneos",
        "question": "¿Es Fut 7 o Fut 11?",
        "answer": (
            "La cancha es de Fut 8 y es grande. Invítales a probarla para que conozcan "
            "sus dimensiones."
        ),
    },
    {
        "key": "tournaments_women",
        "category": "Torneos",
        "question": "¿Tienen torneos de mujeres?",
        "answer": (
            "Sí. Hay una liga femenil que juega los lunes por la noche y, "
            "ocasionalmente, también los martes. Pide sus datos para compartir disponibilidad."
        ),
        "requires_human": True,
    },
)


FAQ_BY_KEY = {entry["key"]: entry for entry in FAQ_ENTRIES}


UNCONFIRMED_TOPICS = (
    "montos exactos de mensualidades, inscripciones, arbitraje y otros precios",
    "promociones o descuentos vigentes",
    "duración exacta de los partidos",
    "ubicaciones o enlaces no incluidos expresamente",
    "reembolsos",
    "transporte",
    "entrenadores asignados",
)
