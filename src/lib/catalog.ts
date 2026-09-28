export type CatalogChapter = {
  id: string;
  title: string;
  src: string;
  text: string;
  bytes: number;
};

export type CatalogBook = {
  id: string;
  title: string;
  author: string;
  year: string;
  narrator: string;
  cover: string;
  blurb: string;
  chapters: CatalogChapter[];
};

const ARCHIVE = "https://archive.org/download";

function track(
  id: string,
  title: string,
  item: string,
  file: string,
  bytes: number,
): CatalogChapter {
  return { id, title, src: `${ARCHIVE}/${item}/${encodeURIComponent(file)}`, text: "", bytes };
}

const aliceItem = "alicesadventuresinwonderland_2005_librivox";

export const BOOKS: CatalogBook[] = [
  {
    id: "magi",
    title: "The Gift of the Magi",
    author: "O. Henry",
    year: "1905",
    narrator: "LibriVox",
    cover: "/covers/magi.jpg",
    blurb: "The whole Christmas story, not an excerpt. A public-domain LibriVox reading.",
    chapters: [
      track(
        "magi-full",
        "The Gift of the Magi",
        "giftofmagi",
        "gift_of_the_magi_henry_blb.mp3",
        12_800_000,
      ),
    ],
  },
  {
    id: "heart",
    title: "The Tell-Tale Heart",
    author: "Edgar Allan Poe",
    year: "1843",
    narrator: "LibriVox",
    cover: "/covers/heart.jpg",
    blurb: "The complete confession, read in full from the public-domain LibriVox archive.",
    chapters: [
      track(
        "heart-full",
        "The Tell-Tale Heart",
        "short_story_051_1203_librivox",
        "shortstory051_telltaleheart_js.mp3",
        14_700_000,
      ),
    ],
  },
  {
    id: "alice",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    year: "1865",
    narrator: "LibriVox",
    cover: "/covers/alice.jpg",
    blurb: "All twelve chapters. A public-domain LibriVox recording of the whole book.",
    chapters: [
      track("alice-01", "Down the Rabbit-Hole", aliceItem, "alicesadventuresinwonderland_01_carroll.mp3", 13_000_000),
      track("alice-02", "The Pool of Tears", aliceItem, "alicesadventuresinwonderland_02_carroll.mp3", 12_500_000),
      track("alice-03", "A Caucus-Race and a Long Tale", aliceItem, "alicesadventuresinwonderland_03_carroll.mp3", 11_000_000),
      track("alice-04", "The Rabbit Sends in a Little Bill", aliceItem, "alicesadventuresinwonderland_04_carroll.mp3", 15_500_000),
      track("alice-05", "Advice from a Caterpillar", aliceItem, "alicesadventuresinwonderland_05_carroll.mp3", 14_000_000),
      track("alice-06", "Pig and Pepper", aliceItem, "alicesadventuresinwonderland_06_carroll.mp3", 15_200_000),
      track("alice-07", "A Mad Tea-Party", aliceItem, "alicesadventuresinwonderland_07_carroll.mp3", 14_600_000),
      track("alice-08", "The Queen's Croquet-Ground", aliceItem, "alicesadventuresinwonderland_08_carroll.mp3", 14_700_000),
      track("alice-09", "The Mock Turtle's Story", aliceItem, "alicesadventuresinwonderland_09_carroll.mp3", 15_400_000),
      track("alice-10", "The Lobster Quadrille", aliceItem, "alicesadventuresinwonderland_10_carroll.mp3", 13_500_000),
      track("alice-11", "Who Stole the Tarts?", aliceItem, "alicesadventuresinwonderland_11_carroll.mp3", 11_300_000),
      track("alice-12", "Alice's Evidence", aliceItem, "alicesadventuresinwonderland_12_carroll.mp3", 12_600_000),
    ],
  },
  {
    id: "wallpaper",
    title: "The Yellow Wallpaper",
    author: "Charlotte Perkins Gilman",
    year: "1892",
    narrator: "LibriVox",
    cover: "/covers/wallpaper.jpg",
    blurb: "The complete story, from a public-domain LibriVox reading.",
    chapters: [
      track(
        "wallpaper-full",
        "The Yellow Wallpaper",
        "short_story_050_1112_librivox",
        "shortstory050_yellowwallpaper_aj.mp3",
        34_900_000,
      ),
    ],
  },
];

export function bookBytes(bookId: string) {
  const book = BOOKS.find((item) => item.id === bookId);
  if (!book) return 0;
  return book.chapters.reduce((sum, chapter) => sum + chapter.bytes, 0);
}
