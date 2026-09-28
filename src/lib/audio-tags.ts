export type AudioTags = {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  picture?: Blob;
};

const textDecoder = new TextDecoder();

function u32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function syncsafe(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset]! & 0x7f) << 21) |
    ((bytes[offset + 1]! & 0x7f) << 14) |
    ((bytes[offset + 2]! & 0x7f) << 7) |
    (bytes[offset + 3]! & 0x7f)
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[offset + i]!);
  return text;
}

function clean(value: string) {
  return value.replace(/\0/g, "").trim();
}

function decodeText(bytes: Uint8Array) {
  if (bytes.length === 0) return "";
  const encoding = bytes[0]!;
  const data = bytes.subarray(1);
  if (encoding === 0) return clean(new TextDecoder("latin1").decode(data));
  if (encoding === 3) return clean(textDecoder.decode(data));
  if (encoding === 2) return clean(new TextDecoder("utf-16be").decode(data));
  let little = false;
  let start = 0;
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    little = true;
    start = 2;
  } else if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) start = 2;
  return clean(new TextDecoder(little ? "utf-16le" : "utf-16be").decode(data.subarray(start)));
}

function cString(bytes: Uint8Array, offset: number, encoding: number) {
  if (encoding === 1 || encoding === 2) {
    for (let i = offset; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        return { text: decodeText(new Uint8Array([encoding, ...bytes.subarray(offset, i)])), next: i + 2 };
      }
    }
  } else {
    for (let i = offset; i < bytes.length; i += 1) {
      if (bytes[i] === 0) return { text: decodeText(new Uint8Array([encoding, ...bytes.subarray(offset, i)])), next: i + 1 };
    }
  }
  return { text: "", next: bytes.length };
}

function readApic(frame: Uint8Array): Blob | undefined {
  if (frame.length < 4) return;
  const encoding = frame[0]!;
  let cursor = 1;
  while (cursor < frame.length && frame[cursor] !== 0) cursor += 1;
  const mime = ascii(frame, 1, cursor - 1).toLowerCase();
  cursor += 1;
  if (cursor >= frame.length) return;
  cursor += 1;
  const described = cString(frame, cursor, encoding);
  const image = frame.subarray(described.next);
  if (image.length < 32) return;
  const type = mime.includes("png") ? "image/png" : "image/jpeg";
  const copy = new Uint8Array(image.byteLength);
  copy.set(image);
  return new Blob([copy], { type });
}

function parseId3(bytes: Uint8Array, version: number): AudioTags {
  const tags: AudioTags = {};
  const v2 = version === 2;
  let offset = 0;
  while (offset + (v2 ? 6 : 10) <= bytes.length) {
    const id = ascii(bytes, offset, v2 ? 3 : 4);
    if (id === "\0\0\0" || id === "\0\0\0\0" || !/^[A-Z0-9]{3,4}$/.test(id)) break;
    const size = v2
      ? (bytes[offset + 3]! << 16) | (bytes[offset + 4]! << 8) | bytes[offset + 5]!
      : version === 4
        ? syncsafe(bytes, offset + 4)
        : u32(bytes, offset + 4);
    const header = v2 ? 6 : 10;
    const start = offset + header;
    const end = start + size;
    if (size <= 0 || end > bytes.length) break;
    const frame = bytes.subarray(start, end);
    if (id === "TIT2" || id === "TT2") tags.title = decodeText(frame);
    else if (id === "TPE1" || id === "TP1") tags.artist = decodeText(frame);
    else if (id === "TPE2" || id === "TP2") tags.albumArtist = decodeText(frame);
    else if (id === "TALB" || id === "TAL") tags.album = decodeText(frame);
    else if ((id === "APIC" || id === "PIC") && !tags.picture) tags.picture = readApic(frame);
    offset = end;
  }
  return tags;
}

function parseId3v1(bytes: Uint8Array): AudioTags {
  if (bytes.length < 128 || ascii(bytes, bytes.length - 128, 3) !== "TAG") return {};
  const start = bytes.length - 128;
  const slice = (from: number, length: number) =>
    clean(new TextDecoder("latin1").decode(bytes.subarray(start + from, start + from + length)));
  return { title: slice(3, 30), artist: slice(33, 30), album: slice(63, 30) };
}

function atomWalk(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (type: string, from: number, to: number) => void,
) {
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = u32(bytes, cursor);
    const type = ascii(bytes, cursor + 4, 4);
    let header = 8;
    if (size === 1 && cursor + 16 <= end) {
      const high = u32(bytes, cursor + 8);
      const low = u32(bytes, cursor + 12);
      size = high * 0x100000000 + low;
      header = 16;
    } else if (size === 0) size = end - cursor;
    if (size < header || cursor + size > end) break;
    visit(type, cursor + header, cursor + size);
    cursor += size;
  }
}

function parseIlst(bytes: Uint8Array, start: number, end: number): AudioTags {
  const tags: AudioTags = {};
  atomWalk(bytes, start, end, (type, from, to) => {
    let dataFrom = 0;
    let dataTo = 0;
    atomWalk(bytes, from, to, (child, childFrom, childTo) => {
      if (child === "data") {
        dataFrom = childFrom;
        dataTo = childTo;
      }
    });
    if (dataTo <= dataFrom + 8) return;
    const kind = u32(bytes, dataFrom);
    const value = bytes.subarray(dataFrom + 8, dataTo);
    const text = () => clean(textDecoder.decode(value));
    if (type === "\u00a9nam") tags.title = text();
    else if (type === "\u00a9ART") tags.artist = text();
    else if (type === "aART") tags.albumArtist = text();
    else if (type === "\u00a9alb") tags.album = text();
    else if (type === "covr" && !tags.picture) {
      const mime = kind === 14 ? "image/png" : "image/jpeg";
      if (value.length > 32) {
        const copy = new Uint8Array(value.byteLength);
        copy.set(value);
        tags.picture = new Blob([copy], { type: mime });
      }
    }
  });
  return tags;
}

function parseMp4(bytes: Uint8Array): AudioTags {
  let tags: AudioTags = {};
  const scan = (start: number, end: number, meta: boolean) => {
    atomWalk(bytes, start, end, (type, from, to) => {
      if (type === "meta") scan(from + 4, to, true);
      else if (meta && type === "ilst") tags = { ...tags, ...parseIlst(bytes, from, to) };
      else if (type === "moov" || type === "udta") scan(from, to, meta);
    });
  };
  scan(0, bytes.length, false);
  return tags;
}

async function readSlice(file: Blob, start: number, end: number) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

export function titleFromFilename(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\d+\s*[.)-]?\s*/, "")
    .replace(/\b(mp3|m4a|m4b|aac|flac|wav|ogg|audiobook|unabridged|librivox|chapter)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readAudioTags(file: Blob): Promise<AudioTags> {
  const head = await readSlice(file, 0, Math.min(file.size, 10));
  if (ascii(head, 0, 3) === "ID3") {
    const version = head[3] ?? 0;
    const tagSize = syncsafe(head, 6);
    const body = await readSlice(file, 10, 10 + Math.min(tagSize, 8_000_000));
    const tags = parseId3(body, version);
    if (tags.title || tags.album || tags.picture) return tags;
  }
  const brand = await readSlice(file, 0, Math.min(file.size, 12));
  if (brand.length >= 8 && ascii(brand, 4, 4) === "ftyp") {
    let offset = 0;
    let moov: { at: number; size: number } | null = null;
    while (offset + 8 <= file.size) {
      const header = await readSlice(file, offset, Math.min(file.size, offset + 16));
      if (header.length < 8) break;
      let size = u32(header, 0);
      const type = ascii(header, 4, 4);
      let headerSize = 8;
      if (size === 1 && header.length >= 16) {
        size = u32(header, 8) * 0x100000000 + u32(header, 12);
        headerSize = 16;
      }
      if (size < headerSize) break;
      if (type === "moov") {
        moov = { at: offset, size };
        break;
      }
      offset += size;
    }
    if (moov && moov.size > 0 && moov.size <= 12_000_000) {
      const box = await readSlice(file, moov.at, moov.at + moov.size);
      const tags = parseMp4(box);
      if (tags.title || tags.album || tags.picture || tags.artist) return tags;
    }
  }
  if (file.size >= 128) {
    const tail = await readSlice(file, file.size - 128, file.size);
    return parseId3v1(tail);
  }
  return {};
}
