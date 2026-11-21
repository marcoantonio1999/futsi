from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.models import GameRoleCross, Match, Round, Site, Team, Tournament, User


class GameRoleMatrixTests(TestCase):
    def setUp(self):
        self.site = Site.objects.create(name="Colegio de prueba", code="prueba")
        other_site = Site.objects.create(name="Otra sede", code="otra")
        self.tournament = Tournament.objects.create(name="Torneo de prueba", site=self.site)
        self.other_tournament = Tournament.objects.create(name="Otro torneo", site=other_site)
        self.home = Team.objects.create(tournament=self.tournament, name="Halcones")
        self.away = Team.objects.create(tournament=self.tournament, name="Tigres")
        self.other = Team.objects.create(tournament=self.other_tournament, name=self.away.name)
        self.user = User.objects.create_user(username="operador", role="collaborator",
            section_permissions=["player_enrollments_only", "game_roles_manage", f"player_enrollments_site:{self.site.pk}"])
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION="Token " + Token.objects.create(user=self.user).key)
        self.url = f"/api/player-enrollments/game-roles/{self.tournament.pk}/"

    def add_round(self, number=1, starts_on="2026-11-07"):
        response = self.client.post(self.url, {"number": number, "starts_on": starts_on}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return next(row for row in response.json()["rounds"] if row["number"] == number)

    def set_cross(self, round_id, home=None, away=None, **fields):
        return self.client.put(self.url, {
            "home_team_id": (home or self.home).pk, "away_team_id": (away or self.away).pk, "round_id": round_id,
            **fields,
        }, format="json")

    def test_game_role_manager_keeps_enrollments_and_site_scope(self):
        self.assertEqual(self.client.get("/api/player-enrollments/").status_code, 200)
        catalog = self.client.get("/api/player-enrollments/catalog/")
        self.assertEqual(catalog.status_code, 200)
        self.assertEqual({row["id"] for row in catalog.json()["teams"]}, {self.home.pk, self.away.pk})
        self.assertEqual(self.client.get("/api/tournaments/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/player-enrollments/game-roles/{self.other_tournament.pk}/").status_code, 404)
        round_id = self.add_round()["id"]
        self.assertEqual(self.set_cross(round_id).status_code, 200)
        self.assertEqual(self.client.get(self.url + f"rounds/{round_id}/share/").status_code, 200)

    def test_weekly_schedule_saves_and_does_not_move_existing_matches(self):
        round_id = self.add_round()["id"]
        match = {"scheduled_on": "2026-11-09", "starts_at": "09:00", "ends_at": "09:50"}
        self.assertEqual(self.set_cross(round_id, schedule=match).status_code, 200)
        block = {"weekday": 1, "starts_at": "10:00", "ends_at": "10:50"}
        payload = {"weekly_schedule": [block], "previous_weekly_schedule": []}
        self.assertEqual(self.client.patch(self.url, payload, format="json").status_code, 200)
        result = self.client.get(self.url).json()
        self.assertEqual(result["weekly_schedule"], [block])
        self.assertEqual(result["crosses"][0]["starts_at"], "09:00:00")
        self.assertEqual(self.client.patch(self.url, payload, format="json").status_code, 200)
        self.assertEqual(self.client.patch(self.url, {**payload, "weekly_schedule": []}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(self.url, {
            "weekly_schedule": [block, {**block, "starts_at": "10:25"}], "previous_weekly_schedule": [block],
        }, format="json").status_code, 400)
        outside = f"/api/player-enrollments/game-roles/{self.other_tournament.pk}/"
        self.assertEqual(self.client.patch(outside, payload, format="json").status_code, 404)
        self.assertEqual(self.client.patch(self.url, {
            "weekly_schedule": [], "previous_weekly_schedule": [block],
        }, format="json").status_code, 200)
        self.assertEqual(self.client.get(self.url).json()["weekly_schedule"], [])

    def test_franco_weekly_schedule_uses_defaults_and_rejects_shared_slot_conflicts(self):
        site = Site.objects.create(pk=27, name="Colegio Franco")
        nocturno = Tournament.objects.create(site=site, name="Nocturno")
        premier = Tournament.objects.create(site=site, name="Premier L.")
        self.client.force_authenticate(User.objects.create_user(username="schedule-admin", role="admin"))
        url = f"/api/player-enrollments/game-roles/{nocturno.pk}/"
        default = self.client.get(url).json()["weekly_schedule"]
        self.assertEqual([(row["weekday"], row["starts_at"]) for row in default], [
            (1, "22:30"), (2, "22:30"), (3, "21:40"), (3, "22:40"), (4, "21:40"), (4, "22:40"),
        ])
        premier_url = f"/api/player-enrollments/game-roles/{premier.pk}/"
        premier_blocks = self.client.get(premier_url).json()["weekly_schedule"]
        self.assertEqual([(row["weekday"], row["starts_at"]) for row in premier_blocks], [
            (2, "20:00"), (2, "20:50"), (3, "20:00"), (3, "20:50"), (4, "20:00"), (4, "20:50"),
        ])
        response = self.client.patch(url, {
            "weekly_schedule": [{"weekday": 3, "starts_at": "21:30", "ends_at": "22:20"}],
            "previous_weekly_schedule": default,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Premier", str(response.data))
        self.assertEqual(self.client.patch(url, {
            "weekly_schedule": [], "previous_weekly_schedule": default,
        }, format="json").status_code, 200)
        self.assertEqual(self.client.get(url).json()["weekly_schedule"], [])

    def test_only_granted_staff_and_administrators_can_manage_game_roles(self):
        round_id = self.add_round()["id"]
        staff = User.objects.create_user(username="ventanilla", role="collaborator",
            section_permissions=["player_enrollments_only", f"player_enrollments_site:{self.site.pk}"])
        self.client.credentials(HTTP_AUTHORIZATION="Token " + Token.objects.create(user=staff).key)
        self.assertEqual(self.client.get("/api/player-enrollments/").status_code, 200)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.url + "team-notes/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.get(self.url + f"rounds/{round_id}/share/").status_code, 403)

        admin = User.objects.create_user(username="administracion", role="admin")
        self.client.credentials(HTTP_AUTHORIZATION="Token " + Token.objects.create(user=admin).key)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.get(self.url + f"rounds/{round_id}/share/").status_code, 200)

    def test_jornadas_and_ordered_crosses_persist_without_creating_matches(self):
        first = self.add_round()
        self.assertEqual(self.add_round()["id"], first["id"])
        second = self.add_round(2, "2026-11-14")
        self.assertEqual(self.set_cross(first["id"]).status_code, 200)
        self.assertEqual(self.set_cross(second["id"], home=self.away, away=self.home).status_code, 200)
        self.assertEqual(self.set_cross(first["id"]).status_code, 200)
        self.assertEqual(GameRoleCross.objects.count(), 2)
        edited = self.client.patch(self.url, {"round_id": first["id"], "number": 3, "starts_on": "2026-11-08"}, format="json")
        self.assertEqual(edited.status_code, 200)
        self.home.name = "Halcones renovados"
        self.home.save()
        matrix = self.client.get(self.url).json()
        self.assertEqual([row["name"] for row in matrix["teams"]], ["Halcones renovados", self.away.name])
        self.assertEqual(matrix["rounds"][-1], {"id": first["id"], "number": 3, "starts_on": "2026-11-08"})
        self.assertEqual([row["round_id"] for row in matrix["crosses"]], [first["id"], second["id"]])
        self.assertEqual(len(self.set_cross(None).json()["crosses"]), 1)
        self.assertFalse(Round.objects.exists())
        self.assertFalse(Match.objects.exists())

    def test_matrix_teams_are_added_manually_in_order_without_changing_history(self):
        first = self.add_round()
        self.assertEqual(self.set_cross(first["id"]).status_code, 200)
        self.assertEqual(self.client.get(self.url).json()["matrix_team_ids"], [])
        for team in (self.away, self.home, self.away):
            response = self.client.patch(self.url, {"add_team_id": team.pk}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(self.url, {"add_team_id": self.other.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        matrix = self.client.get(self.url).json()
        self.assertEqual(matrix["matrix_team_ids"], [self.away.pk, self.home.pk])
        self.assertEqual(len(matrix["crosses"]), 1)
        self.assertEqual(len(matrix["teams"]), 2)

    def test_create_team_adds_it_to_selected_tournament_and_matrix(self):
        data = {"name": " Nuevo equipo ", "representative_name": "Delegado de prueba"}
        response = self.client.patch(self.url, {"new_team": data}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        team = self.tournament.teams.get(name="Nuevo equipo")
        self.assertEqual(team.representative_name, data["representative_name"])
        self.assertTrue(team.is_active)
        self.assertEqual(response.json()["matrix_team_ids"], [team.pk])
        self.assertIn({"id": team.pk, "name": team.name, "is_active": True}, response.json()["teams"])
        self.assertEqual(self.client.get(self.url).json()["matrix_team_ids"], [team.pk])

        self.assertEqual(self.client.patch(self.url, {"new_team": data}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(self.url, {"new_team": {"name": "Sin delegado"}}, format="json").status_code, 400)
        outside = f"/api/player-enrollments/game-roles/{self.other_tournament.pk}/"
        self.assertEqual(self.client.patch(outside, {"new_team": data}, format="json").status_code, 404)
        self.assertFalse(Team.objects.filter(name="Sin delegado").exists())
        self.assertEqual(Team.objects.filter(name="Nuevo equipo").count(), 1)

    def test_tournament_scope_and_input_validation(self):
        second = self.add_round(2)
        outside = f"/api/player-enrollments/game-roles/{self.other_tournament.pk}/"
        self.assertEqual(self.client.get(outside).status_code, 404)
        self.assertEqual(self.client.post(outside, {"number": 1, "starts_on": "2026-11-07"}, format="json").status_code, 404)
        self.assertEqual(self.set_cross(second["id"], away=self.other).status_code, 400)
        self.assertEqual(self.set_cross(second["id"], away=self.home).status_code, 400)
        foreign_round = self.other_tournament.game_role_rounds.create(number=1, starts_on="2026-11-07")
        self.assertEqual(self.set_cross(foreign_round.pk).status_code, 404)
        self.assertEqual(self.client.post(self.url, {"number": 2, "starts_on": "2026-11-08"}, format="json").status_code, 400)
        self.assertFalse(GameRoleCross.objects.exists())
        self.client.credentials()
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_team_notes_use_tournament_teams_and_rounds_and_survive_retry(self):
        first = self.add_round()
        path = self.url + "team-notes/"
        permit = {"kind": "permit", "team_id": self.home.pk, "round_id": first["id"], "note": "Solicitó descanso"}
        for _ in range(2):
            response = self.client.post(path, permit, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["team_notes"]), 1)
        unavailable = {"kind": "unavailable", "team_id": self.away.pk, "weekday": 2}
        response = self.client.post(path, unavailable, format="json")
        self.assertEqual(response.status_code, 200)
        notes = self.client.get(self.url).json()["team_notes"]
        self.assertEqual([(row["kind"], row["team_id"]) for row in notes],
                         [("permit", self.home.pk), ("unavailable", self.away.pk)])
        self.assertEqual(notes[1]["weekday"], 2)
        self.assertEqual(self.client.post(path, {**unavailable, "starts_at": "17:00"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(path, {**permit, "team_id": self.other.pk}, format="json").status_code, 404)
        foreign_round = self.other_tournament.game_role_rounds.create(number=1, starts_on="2026-11-07")
        self.assertEqual(self.client.post(path, {**permit, "round_id": foreign_round.pk}, format="json").status_code, 404)
        outside = f"/api/player-enrollments/game-roles/{self.other_tournament.pk}/team-notes/"
        self.assertEqual(self.client.post(outside, permit, format="json").status_code, 404)

    def test_shared_round_reads_current_public_schedule_only(self):
        first = self.add_round()
        second = self.add_round(2, "2026-11-14")
        schedule = {"scheduled_on": "2026-11-08", "starts_at": "10:00", "ends_at": "11:00"}
        self.set_cross(first["id"], schedule=schedule)
        self.set_cross(first["id"], self.away, self.home)
        self.client.post(self.url + "team-notes/", {
            "kind": "permit", "team_id": self.home.pk, "round_id": first["id"], "note": "Nota interna",
        }, format="json")
        shared = self.client.get(self.url + f"rounds/{first['id']}/share/").json()
        public = APIClient()
        path = f"/api/public/game-roles/{shared['token']}/"
        response = public.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(len(response.json()["matches"]), 1)
        self.assertEqual(response.json()["scoring"], [])
        self.assertNotIn("team_notes", response.json())
        self.assertNotIn("home_goals", response.json()["matches"][0])
        self.assertEqual(public.get(path.rstrip("/") + "x/").status_code, 404)
        self.assertEqual(public.get(self.url + f"rounds/{first['id']}/share/").status_code, 401)
        self.set_cross(second["id"], schedule={**schedule, "scheduled_on": "2026-11-15"}, played=True,
                       score={"home_goals": 3, "away_goals": 1})
        updated = public.get(path).json()
        self.assertEqual(updated["matches"], [])
        self.assertEqual(updated["scoring"], [{"team": self.home.name, "goals": 3}, {"team": self.away.name, "goals": 1}])
        second_report = self.client.get(self.url + f"rounds/{second['id']}/share/").json()
        self.assertEqual(second_report["results_round"], 2)
        self.assertEqual(second_report["results"][0]["home_goals"], 3)
        self.assertEqual(second_report["results"][0]["away_goals"], 1)
        self.assertEqual([row["team"] for row in second_report["standings"]], [self.home.pk, self.away.pk])


    def test_standings_rank_final_scores_by_points_difference_and_goals(self):
        round_id = self.add_round()["id"]
        other_teams = [Team.objects.create(tournament=self.tournament, name=name)
                       for name in ("Rojos", "Azules", "Verdes", "Amarillos")]
        third, fourth, fifth, sixth = other_teams
        for home, away, goals in [
            (self.home, fourth, (3, 1)), (self.away, fifth, (2, 0)), (third, sixth, (1, 0)),
            (fourth, sixth, (0, 0)),
        ]:
            response = self.set_cross(round_id, home, away, played=True,
                                      score={"home_goals": goals[0], "away_goals": goals[1]})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.set_cross(round_id, self.away, third, played=True).status_code, 200)
        self.assertEqual(self.set_cross(round_id, fifth, self.home, played=False,
                                       score={"home_goals": 20, "away_goals": 0}).status_code, 200)
        rows = self.client.get(self.url).json()["standings"]
        self.assertEqual([(row["team"], row["points"], row["goal_difference"], row["goals_for"]) for row in rows[:3]],
                         [(self.home.pk, 3, 2, 3), (self.away.pk, 3, 2, 2), (third.pk, 3, 1, 1)])
        self.assertEqual(rows[0]["played"], 1)
        self.assertEqual(next(row for row in rows if row["team"] == fourth.pk)["drawn"], 1)
        self.assertEqual(self.set_cross(round_id, self.home, third, played=True, score={"home_goals": 1}).status_code, 400)

    def test_schedule_checks_week_and_overlap_and_preserves_played_state(self):
        first = self.add_round()
        schedule = {"scheduled_on": "2026-11-09", "starts_at": "09:00", "ends_at": "10:00"}
        response = self.set_cross(first["id"], schedule=schedule)
        self.assertEqual(response.status_code, 200)
        cross = response.json()["crosses"][0]
        self.assertEqual(cross["scheduled_on"], "2026-11-09")
        self.assertEqual(cross["starts_at"], "09:00:00")
        self.assertFalse(cross["played"])
        self.assertEqual(self.set_cross(first["id"], played=True).status_code, 200)
        legacy = self.set_cross(first["id"]).json()["crosses"][0]
        self.assertTrue(legacy["played"])
        self.assertEqual(legacy["scheduled_on"], schedule["scheduled_on"])

        for changes in [{"starts_at": "09:30", "ends_at": "10:30"}, {"ends_at": "09:00"}, {"scheduled_on": "2026-11-14"}]:
            with self.subTest(changes=changes):
                rejected = self.set_cross(first["id"], self.away, self.home, schedule={**schedule, **changes})
                self.assertEqual(rejected.status_code, 400)
        adjacent = self.set_cross(first["id"], self.away, self.home, schedule={**schedule, "starts_at": "10:00", "ends_at": "11:00"})
        self.assertEqual(adjacent.status_code, 200)
        moved_week = self.client.patch(self.url, {"round_id": first["id"], "number": 1, "starts_on": "2026-11-10"}, format="json")
        self.assertEqual(moved_week.status_code, 400)
        self.assertEqual(self.set_cross(None, schedule=schedule).status_code, 400)
        cleared = self.set_cross(first["id"], schedule=None, played=False).json()["crosses"][0]
        self.assertIsNone(cleared["scheduled_on"])
        self.assertIsNone(cleared["starts_at"])
        self.assertIsNone(cleared["ends_at"])
        self.assertFalse(cleared["played"])
