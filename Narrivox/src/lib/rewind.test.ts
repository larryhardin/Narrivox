import assert from "node:assert/strict";
import test from "node:test";
import { rewindTarget } from "./rewind.ts";

test("rewinding 15 seconds from 0:05 lands 10 seconds before the end of the previous chapter", () => {
  const landing = rewindTarget(5, 15, [120]);
  assert.equal(landing.stepsBack, 1);
  assert.equal(landing.time, 110);
});

test("rewind keeps going when the previous chapter is shorter than the leftover", () => {
  const landing = rewindTarget(5, 15, [8, 120]);
  assert.equal(landing.stepsBack, 2);
  assert.equal(landing.time, 118);
});

test("rewind stops at the start when there is no earlier audio", () => {
  assert.deepEqual(rewindTarget(5, 15, []), { stepsBack: 0, time: 0 });
  assert.deepEqual(rewindTarget(20, 15, []), { stepsBack: 0, time: 5 });
});
