def build_standings(teams, match_rows):
    table = {
        team_id: {
            "team": team_id, "team_name": name, "tournament": tournament_id,
            "played": 0, "won": 0, "drawn": 0, "lost": 0, "goals_for": 0, "goals_against": 0, "points": 0,
        }
        for team_id, name, tournament_id in teams
    }
    for home_id, away_id, home_goals, away_goals in match_rows:
        if home_id not in table or away_id not in table:
            continue
        home, away = table[home_id], table[away_id]
        home["played"] += 1
        away["played"] += 1
        home["goals_for"] += home_goals
        home["goals_against"] += away_goals
        away["goals_for"] += away_goals
        away["goals_against"] += home_goals
        if home_goals == away_goals:
            for row in (home, away):
                row["drawn"] += 1
                row["points"] += 1
        else:
            winner, loser = (home, away) if home_goals > away_goals else (away, home)
            winner["won"] += 1
            winner["points"] += 3
            loser["lost"] += 1
    rows = list(table.values())
    for row in rows:
        row["goal_difference"] = row["goals_for"] - row["goals_against"]
    rows.sort(key=lambda row: (row["points"], row["goal_difference"], row["goals_for"], row["team_name"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["position"] = index
        row["is_leader"] = index == 1 and row["played"] > 0
    return rows
