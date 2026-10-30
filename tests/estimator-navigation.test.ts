import test from "node:test";
import assert from "node:assert/strict";
import { destinationToView, hashToView, sameView, viewLabel, viewToHash } from "../src/services/navigation";

test("Estimator tab and request links preserve their independent workspace", () => {
  assert.deepEqual(destinationToView("estimator"), { kind: "estimator" });
  assert.deepEqual(hashToView("#/estimator"), { kind: "estimator" });
  const request = { kind: "request", id: "request/with spaces", estimator: true } as const;
  assert.equal(viewToHash(request), "#/estimator/request%2Fwith%20spaces");
  assert.deepEqual(hashToView(viewToHash(request)), request);
  assert.equal(viewLabel(request), "Estimator review");
  assert.equal(sameView(request, { kind: "request", id: request.id }), false);
  assert.equal(sameView(request, { ...request }), true);
});

test("Existing request URLs keep the project manager review flow", () => {
  const request = { kind: "request", id: "r1" } as const;
  assert.deepEqual(hashToView("#/requests/r1"), request);
  assert.equal(viewToHash(request), "#/requests/r1");
  assert.equal(sameView(request, { ...request, estimator: false }), true);
  assert.deepEqual(hashToView("#/review"), { kind: "review" });
});
