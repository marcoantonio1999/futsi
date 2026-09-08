import test from "node:test";
import assert from "node:assert/strict";
import { standingsForTournament } from "../src/components/views/sportsViewModel.ts";

test("each tournament starts at position one even when the API returns a global ranking", () => {
  const rows = [
    { team: 1, tournament: 10, position: 1, played: 3, is_leader: true },
    { team: 2, tournament: 20, position: 19, played: 3, is_leader: false },
    { team: 3, tournament: 20, position: 8, played: 3, is_leader: false },
    { team: 4, tournament: 20, position: 31, played: 3, is_leader: false },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(standingsForTournament(rows, 20).map(({ team, position, is_leader }) => ({ team, position, is_leader })), [
    { team: 3, position: 1, is_leader: true },
    { team: 2, position: 2, is_leader: false },
    { team: 4, position: 3, is_leader: false },
  ]);
  assert.deepEqual(rows, before, "switching tournaments must not mutate shared data");
});

test("a tournament without results does not invent a leader or borrow another tournament's standings", () => {
  const rows = [{ team: 1, tournament: 10, position: 7, played: 0, is_leader: false }];
  assert.equal(standingsForTournament(rows, 10)[0].is_leader, false);
  assert.deepEqual(standingsForTournament(rows, 20), []);
  assert.deepEqual(standingsForTournament(rows), []);
});
