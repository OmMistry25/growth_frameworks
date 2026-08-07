import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface ParityCase {
  readonly id: string;
  readonly behavior: string;
}

interface ParityFixture {
  readonly schemaVersion: number;
  readonly reference: {
    readonly repository: string;
    readonly commit: string;
  };
  readonly dataPolicy: string;
  readonly cases: readonly ParityCase[];
}

const fixtureUrl = new URL("./fixtures/parity-cases.json", import.meta.url);

test("parity fixture is synthetic and pinned to the approved reference", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as ParityFixture;

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.reference.repository, "spy");
  assert.equal(fixture.reference.commit, "44e5d95e1df903f22fa401f02eb7c8bd58d6838e");
  assert.equal(fixture.dataPolicy, "synthetic-only");
});

test("parity fixture identifiers are unique and cover the entry cases", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as ParityFixture;
  const ids = fixture.cases.map(({ id }) => id);
  const behaviors = new Set(fixture.cases.map(({ behavior }) => behavior));

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(behaviors.has("domain_normalization"));
  assert.ok(behaviors.has("state_transition"));
  assert.ok(behaviors.has("due_selection"));
  assert.ok(behaviors.has("idempotency"));
});
