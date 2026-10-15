import assert from "node:assert/strict";
import test from "node:test";
import { folderNameFromRelative, isDirectFolderFile, orderFolderAudio } from "./folder-import.ts";
import { readAudioTags, trackFromText } from "./audio-tags.ts";

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

test("a number at the start, or a plain number with a space, is a chapter", () => {
  const leading = orderFolderAudio("The Druid of Shannara", [
    "2 of 2 Terry Brooks The Druid of Shannara.mp3",
    "1 of 2 Terry Brooks The Druid of Shannara.m4a",
    "cover.jpg",
    "notes.txt",
  ]);
  assert.equal(leading.ok, true);
  if (!leading.ok) return;
  assert.deepEqual(
    leading.chapters.map((chapter) => chapter.index),
    [1, 2],
  );
  assert.deepEqual(
    leading.chapters.map((chapter) => chapter.position),
    [1, 0],
  );

  const plain = orderFolderAudio("Indomitable", [
    "Terry Brooks - Shannara - Indomitable - 2 .mp3",
    "Terry Brooks - Shannara - Indomitable - 1 .mp3",
    "folder.jpg",
  ]);
  assert.equal(plain.ok, true);
  if (!plain.ok) return;
  assert.deepEqual(
    plain.chapters.map((chapter) => chapter.index),
    [1, 2],
  );
});

test("wav and other audio are not chapters", () => {
  const result = orderFolderAudio("The Sword of Shannara", ["01.wav", "02.flac", "cover.png"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /mp3 or m4a/);
});

test("only a file directly inside the selected folder counts", () => {
  assert.equal(isDirectFolderFile("The Sword of Shannara/01.mp3"), true);
  assert.equal(isDirectFolderFile("The Sword of Shannara/disc 1/01.mp3"), false);
  assert.equal(folderNameFromRelative("The Sword of Shannara/01.mp3"), "The Sword of Shannara");
});

test("a track number in the file is the chapter, and the audio count is the total", () => {
  const result = orderFolderAudio("Indomitable", [
    "notes.txt",
    { name: "later.mp3", track: 2 },
    { name: "opening.mp3", track: 1 },
    "cover.jpg",
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.chapters.length, 2);
  assert.deepEqual(
    result.chapters.map((chapter) => [chapter.index, chapter.position]),
    [
      [1, 2],
      [2, 1],
    ],
  );
});

test("two files cannot share a track number", () => {
  const result = orderFolderAudio("Indomitable", [
    { name: "a.mp3", track: 1 },
    { name: "b.m4a", track: 1 },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /same chapter number/);
});

test("the track field is a single number, with or without a total", () => {
  assert.equal(trackFromText("1"), 1);
  assert.equal(trackFromText("01"), 1);
  assert.equal(trackFromText("1/11"), 1);
  assert.equal(trackFromText("1 of 11"), 1);
  assert.equal(trackFromText("Chapter 1"), undefined);
});

test("an mp3 track frame is read as the chapter number", async () => {
  const text = "1";
  const body = new Uint8Array(1 + text.length);
  body[0] = 0;
  body[1] = text.charCodeAt(0);
  const frame = new Uint8Array(10 + body.length);
  frame.set([84, 82, 67, 75, 0, 0, 0, body.length, 0, 0]);
  frame.set(body, 10);
  const size = frame.length;
  const header = new Uint8Array([
    73, 68, 51, 3, 0, 0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
  const file = new Blob([header, frame], { type: "audio/mpeg" });
  const tags = await readAudioTags(file);
  assert.equal(tags.track, 1);
});
