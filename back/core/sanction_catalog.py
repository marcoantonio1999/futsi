"""User-supplied tabulator. Suggestions only, never automatic penalties."""
GROUPS = {
    1: 'Juego brusco grave', 2: 'Conducta violenta', 3: 'Escupir a otra persona',
    4: 'Mano intencionada para impedir gol', 5: 'Impedir una oportunidad manifiesta de gol',
    6: 'Lenguaje ofensivo, amenazas o gestos', 7: 'Segunda amonestación', 8: 'Otros incidentes',
}
GROUP_DETAILS = {
    1: 'Fuerza excesiva o brutalidad contra el adversario al disputar el balón en juego.',
    2: 'Fuerza excesiva o brutalidad sin disputar el balón, contra rivales, compañeros, público, árbitros u otras personas, dentro o fuera del terreno.',
}
ROWS = [
    (1,'Juego brusco grave','De 3 semanas a 2 meses'),
    (2,'Intento de riña sin llegar a golpes','De 3 a 8 semanas'),
    (2,'Intento de agresión a un contrario o compañero','De 3 a 5 semanas'),
    (2,'Intento de agresión a un árbitro','De 4 meses a 1 año'),
    (2,'Agresión a un contrario','De 4 semanas a baja definitiva'),
    (2,'Riña con menos de 4 jugadores','De 2 meses a baja definitiva'),
    (2,'Riña con más de 3 jugadores','Baja definitiva del equipo; del jugador en todos sus equipos'),
    (2,'Agresión al público','De 2 meses a baja definitiva'),
    (2,'Agresión a un árbitro','De 6 meses a 2 años; pérdida del partido según el reglamento'),
    (2,'Agresión a un árbitro causando lesión','De 2 años a baja de la liga; otras consecuencias señaladas en el tabulador'),
    (3,'Escupir a otro jugador','De 4 a 7 meses'),
    (3,'Escupir a un espectador','De 6 a 9 meses'),
    (3,'Escupir a un árbitro','De 8 meses a 1 año'),
    (3,'Escupir a un directivo','Baja definitiva'),
    (4,'Mano intencionada para impedir gol (salvo guardameta en su área)','De 1 a 2 semanas'),
    (5,'Impedir oportunidad manifiesta de gol mediante falta','2 semanas'),
    (6,'Burlarse de un árbitro','De 2 a 4 semanas'),
    (6,'Insultos a un árbitro','De 4 a 7 semanas'),
    (6,'Insultos a un árbitro y reincidir fuera de la cancha','De 6 a 8 semanas'),
    (6,'Insultos a un contrario o compañero','De 2 a 6 semanas'),
    (6,'Insultos a un directivo','De 8 a 10 semanas'),
    (6,'Amenazas a un árbitro','De 3 meses a baja definitiva'),
    (6,'Amenazas a un directivo','Baja definitiva'),
    (6,'Insultos e inducción a violencia verbal o con señas','De 2 meses a 1 año'),
    (7,'Segunda amonestación en el mismo partido','De 1 a 2 semanas'),
    (8,'Capitán que no firma la cédula de juego','1 semana'),
    (8,'Dañar intencionalmente la instalación','De 3 meses a baja definitiva; reparación del daño'),
    (8,'Dañar intencionalmente el balón','3 semanas; reparación del daño'),
    (8,'Ofrecer dinero o bienes para alterar el resultado','6 meses; pérdida del partido'),
    (8,'Retrasar el juego después de ser expulsado','2 semanas adicionales'),
    (8,'Suplantar registro de otro jugador','4 semanas para jugador y delegado; pérdida del partido'),
    (8,'Utilizar documentación falsa','Baja del torneo para jugador; 4 semanas para delegado; pérdida del partido'),
    (8,'Alinear en dos equipos de la misma categoría y torneo','Baja del torneo (con las excepciones del reglamento)'),
    (8,'Alinear a un jugador sancionado','Duplicar sanción al jugador; derrota del equipo 5 a 0'),
    (8,'Intentar jugar con aliento alcohólico','1 semana'),
    (8,'Jugar con aliento alcohólico','2 semanas'),
    (8,'Acumular 4 expulsiones en la temporada','6 meses'),
    (8,'Ingresar desde la banca a una riña sin participar','2 semanas'),
    (8,'Acompañantes que insulten, amenacen o agredan','De 2 semanas a baja definitiva para delegado, capitán o equipo'),
]
CATALOG = [{'code':f's{index:02d}','group':GROUPS[group],'label':label,'recommendation':suggestion,'description':GROUP_DETAILS.get(group,'')}
           for index,(group,label,suggestion) in enumerate(ROWS,1)]
BY_CODE = {row['code']:row for row in CATALOG}
