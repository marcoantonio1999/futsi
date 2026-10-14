import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEnrollmentName } from "../src/features/enrollments/enrollmentName.ts";

test("requires all three name components, including non-whitespace surnames", () => {
  for (let index = 0; index < 3; index++) {
    for (const blank of ["", "   "]) {
      const parts = ["José Luis", "De la Cruz", "Orduña"];
      parts[index] = blank;
      assert.ok(validateEnrollmentName(parts));
    }
  }
});
test("accepts multiple given names, compound surnames and accents", () => {
  assert.equal(validateEnrollmentName([" José  Luis ", "De la Cruz", "Orduña"]), "");
  assert.equal(validateEnrollmentName(["María", "O’Neill", "Pérez-López"]), "");
});
test("rejects numbers, placeholders and excessive total length", () => {
  for (const surname of ["123", "---", "Pérez123", "😊"]) {
    assert.ok(validateEnrollmentName(["José Luis", surname, "Orduña"]));
  }
  assert.ok(validateEnrollmentName(["a".repeat(80), "b".repeat(80), "c"]));
});
