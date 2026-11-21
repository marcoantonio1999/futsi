import re
from unicodedata import normalize


# Sunday is zero. Liga Franco blocks originally came from ROLES AP TERMINADOS.xlsx.
FRANCO_STARTS = {
    "premier": {day: ("20:00", "20:50") for day in (2, 3, 4)},
    "nocturno": {1: ("22:30",), 2: ("22:30",), 3: ("21:40", "22:30"), 4: ("21:40", "22:30")},
    "espanola": {6: ("09:00", "09:50", "10:40", "11:30", "12:20", "13:10", "14:00")},
    "eurocopa": {6: ("14:50", "15:40", "16:30", "17:20", "18:10", "19:00", "19:50")},
    "uefa": {0: ("14:00", "14:50", "15:40", "16:30", "17:20", "18:10", "19:00", "19:50")},
}
FRANCO_SITE_ID = 27


def tournament_schedule(tournament):
    if tournament.game_role_schedule is not None:
        return tournament.game_role_schedule
    if tournament.site_id != FRANCO_SITE_ID:
        return []
    name = normalize("NFD", tournament.name.strip().lower()).encode("ascii", "ignore").decode()
    if re.fullmatch(r"premier (?:l\.?|liga(?: \d{4})?)", name):
        name = "premier"
    blocks = []
    for weekday, starts in FRANCO_STARTS.get(name, {}).items():
        for start in starts:
            hours, minutes = map(int, start.split(":"))
            end_hour, end_minute = divmod(hours * 60 + minutes + 50, 60)
            blocks.append({"weekday": weekday, "starts_at": start, "ends_at": f"{end_hour:02}:{end_minute:02}"})
    return blocks
