import assert from "node:assert/strict";
import test from "node:test";

import { createPinnedLookup } from "../src/pinned-lookup.ts";

test("returns a single pinned address for the traditional lookup contract", async () => {
  const result = await invokeLookup(false);
  assert.deepEqual(result, { address: "203.0.113.10", family: 4 });
});

test("returns an address array when Node 24 requests all addresses", async () => {
  const result = await invokeLookup(true);
  assert.deepEqual(result, [{ address: "203.0.113.10", family: 4 }]);
});

function invokeLookup(all: boolean): Promise<unknown> {
  const lookup = createPinnedLookup("203.0.113.10", 4);
  return new Promise((resolve, reject) => {
    lookup("ignored.example", { all }, (error, address, family) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(Array.isArray(address) ? address : { address, family });
    });
  });
}
