import assert from "node:assert/strict";
import test from "node:test";
import { audioFileName, parseAudioFileName } from "./folder-library.ts";

test("audio file names round-trip without path separators", () => {
  const name = audioFileName("magi", "magi-full");
  assert.equal(name.includes("/"), false);
  assert.equal(name.includes("\\"), false);
  assert.deepEqual(parseAudioFileName(name), { bookId: "magi", chapterId: "magi-full" });

  const bookId = "11111111-1111-1111-1111-111111111111";
  const chapterId = "22222222-2222-2222-2222-222222222222";
  assert.deepEqual(parseAudioFileName(audioFileName(bookId, chapterId)), { bookId, chapterId });
});
