import test from "node:test";
import assert from "node:assert/strict";
import { amountInCents, paymentValidation, collectDirect } from "../src/features/billing/billingFlow.ts";

test("amounts use cents without accepting invalid or over-precision values", () => {
  assert.equal(amountInCents("1250.50"), 125050);
  assert.equal(amountInCents("0.29"), 29);
  for (const value of ["", "-1", "1.001", "NaN", "Infinity", "1e3", "1,000", "99999999999999999"]) assert.equal(amountInCents(value), null);
});

const directInput = { charge: { student: 1, amount: "1250.00" }, discountCents: 25000, totalCents: 100000, reason: "Hermanos", method: "cash" };
function directMocks(status = "approved") {
  const calls = [];
  return { calls, callbacks: {
    charge: async p => { calls.push(["charge", p]); return { id: 10, balance: "1250.00" }; },
    discount: async p => { calls.push(["discount", p]); return { id: 20, status }; },
    payment: async p => { calls.push(["payment", p]); return { id: 30, status: "registered", ...p }; },
    onCharge: () => undefined,
  } };
}
test("one submit creates charge, approved discount and net payment", async () => {
  const { calls, callbacks } = directMocks(); const attempt = {};
  assert.equal(await collectDirect(attempt, directInput, callbacks), "complete");
  assert.deepEqual(calls.map(c => c[0]), ["charge", "discount", "payment"]);
  assert.equal(calls[2][1].amount, "1000.00"); assert.equal(calls[2][1].charge, 10);
  await collectDirect(attempt, directInput, callbacks); assert.equal(calls.length, 3);
});
test("payment rejection preserves charge and discount for retry", async () => {
  const { calls, callbacks } = directMocks(); const attempt = {};
  const originalPayment = callbacks.payment;
  callbacks.payment = async () => { throw new Error("rejected"); };
  await assert.rejects(collectDirect(attempt, directInput, callbacks));
  assert.equal(attempt.charge.id, 10); assert.equal(attempt.discount.id, 20);
  callbacks.payment = originalPayment;
  await collectDirect(attempt, directInput, callbacks);
  assert.deepEqual(calls.map(c => c[0]), ["charge", "discount", "payment"]);
});
test("requested discount does not register a payment or bypass approval", async () => {
  const { calls, callbacks } = directMocks("requested");
  assert.equal(await collectDirect({}, directInput, callbacks), "approval");
  assert.deepEqual(calls.map(c => c[0]), ["charge", "discount"]);
});
test("full approved discount does not create a zero payment", async () => {
  const { calls, callbacks } = directMocks();
  assert.equal(await collectDirect({}, { ...directInput, discountCents: 125000, totalCents: 0 }, callbacks), "complete");
  assert.deepEqual(calls.map(c => c[0]), ["charge", "discount"]);
});
test("full and partial payments are valid", () => {
  assert.equal(paymentValidation({ status: "pending", balance: "1250.00" }, "1250"), "");
  assert.equal(paymentValidation({ status: "partial", balance: "750.50" }, "500.25"), "");
});
test("zero, excess, closed and canceled payments are blocked", () => {
  for (const value of ["0", "-1", "1250.01", "NaN"]) assert.ok(paymentValidation({ status: "pending", balance: "1250.00" }, value));
  for (const status of ["paid", "canceled"]) assert.ok(paymentValidation({ status, balance: "1250.00" }, "100"));
});
