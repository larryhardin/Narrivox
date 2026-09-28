export type Chapter = {
  id: string;
  title: string;
  src?: string;
  text?: string;
};

export type ShelfBook = {
  id: string;
  title: string;
  author: string;
  year?: string;
  narrator?: string;
  blurb?: string;
  cover?: string;
  source: "library" | "yours";
  chapters: Chapter[];
};

export type UserBook = {
  id: string;
  title: string;
  author: string;
  year?: string;
  narrator?: string;
  cover?: string;
  createdAt: number;
  chapters: { id: string; title: string }[];
};

export type ProgressEntry = {
  chapterId: string;
  times: Record<string, number>;
  done: string[];
  finished: boolean;
  updatedAt: number;
};

export type Bookmark = {
  id: string;
  bookId: string;
  chapterId: string;
  time: number;
  createdAt: number;
};

export type SleepState =
  | { mode: "off" }
  | { mode: "minutes"; minutes: 15 | 30 | 45; endsAt: number }
  | { mode: "chapter" };

export type ActiveBook = {
  bookId: string;
  title: string;
  author: string;
  cover?: string;
  narrator?: string;
  chapters: Chapter[];
  chapterId: string;
};

export type Screen = "shelf" | "book" | "now";
