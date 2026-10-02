import assert from "node:assert/strict";
import test from "node:test";
import { folderNameFromRelative, isDirectFolderFile, orderFolderAudio } from "./folder-import.ts";

function shannara(count = 21) {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `Terry_Brooks_-_The_Sword_of_Shannara_-_${number}_of_${String(count).padStart(2, "0")}.mp3`;
  });
}

test("a numbered folder becomes one book in chapter order", () => {
  const names = shannara();
  const reversed = names.slice().reverse();
  const result = orderFolderAudio("The Sword of Shannara", reversed);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.title, "The Sword of Shannara");
  assert.equal(result.author, "");
  assert.equal(result.chapters.length, 21);
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.index),
    Array.from({ length: 21 }, (_, index) => index + 1),
  );
  assert.equal(result.chapters[0]?.title, "Chapter 1");
  assert.equal(result.chapters[0]?.position, 20);
  assert.equal(result.chapters[20]?.position, 0);
});

test("the folder name is the book, even when the files use another name", () => {
  const names = shannara();
  const result = orderFolderAudio("Downloads", names);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.title, "Downloads");

  const split = orderFolderAudio("Terry Brooks - The Sword of Shannara", ["01.mp3", "02.mp3"]);
  assert.equal(split.ok, true);
  if (!split.ok) return;
  assert.equal(split.title, "The Sword of Shannara");
  assert.equal(split.author, "Terry Brooks");

  const mixed = orderFolderAudio("The Sword of Shannara", [
    "anything_-_01_of_02.mp3",
    "something_else_-_02_of_02.mp3",
  ]);
  assert.equal(mixed.ok, true);
});

test("a missing chapter is still an error", () => {
  const gap = shannara().filter((name) => !name.includes("_10_of_"));
  const result = orderFolderAudio("The Sword of Shannara", gap);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /complete sequence/);
});

test("files without a reliable number are rejected", () => {
  const result = orderFolderAudio("The Sword of Shannara", [
    "Terry_Brooks_-_The_Sword_of_Shannara_-_opening.mp3",
    "Terry_Brooks_-_The_Sword_of_Shannara_-_closing.mp3",
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /order isn't clear/);
});

test("plain numbered files take their title from the folder", () => {
  const result = orderFolderAudio("The Sword of Shannara", ["02.mp3", "01.mp3"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.author, "");
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.index),
    [1, 2],
  );
});

test("only a file directly inside the selected folder counts", () => {
  assert.equal(isDirectFolderFile("The Sword of Shannara/01.mp3"), true);
  assert.equal(isDirectFolderFile("The Sword of Shannara/disc 1/01.mp3"), false);
  assert.equal(folderNameFromRelative("The Sword of Shannara/01.mp3"), "The Sword of Shannara");
});
