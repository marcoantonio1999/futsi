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
            section_permissions=["player_enrollments_only", f"player_enrollments_site:{self.site.pk}"])
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
        self.assertNotIn("team_notes", response.json())
        self.assertNotIn("home_goals", response.json()["matches"][0])
        self.assertEqual(public.get(path.rstrip("/") + "x/").status_code, 404)
        self.assertEqual(public.get(self.url + f"rounds/{first['id']}/share/").status_code, 401)
        self.set_cross(second["id"], schedule={**schedule, "scheduled_on": "2026-11-15"})
        self.assertEqual(public.get(path).json()["matches"], [])

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
