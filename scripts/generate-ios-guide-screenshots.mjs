import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const outputDirectory = join(process.cwd(), "public", "install");
const width = 390;
const height = 260;

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function rasterize(name) {
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  const setPixel = (x, y, [red, green, blue, alpha = 255]) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = alpha;
  };
  const rectangle = (left, top, right, bottom, color) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) setPixel(x, y, color);
    }
  };
  const circle = (centerX, centerY, radius, color) => {
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(x, y, color);
      }
    }
  };
  const blue = [52, 120, 212];
  const white = [255, 255, 255];
  const text = [28, 28, 30];
  const muted = [209, 209, 214];
  const background = name === "ios-add-to-home-screen" ? [142, 142, 147] : [242, 242, 247];
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      setPixel(x, y, background);
    }
  }
  if (name === "ios-share") {
    rectangle(20, 18, 369, 194, white);
    rectangle(40, 43, 349, 59, [229, 229, 234]);
    rectangle(40, 77, 230, 90, text);
    rectangle(40, 105, 310, 114, muted);
    rectangle(40, 125, 270, 134, muted);
    rectangle(40, 145, 290, 154, muted);
    rectangle(0, 205, 389, 259, white);
    circle(194, 234, 29, blue);
    circle(194, 234, 25, white);
    rectangle(191, 220, 196, 240, blue);
    rectangle(184, 234, 203, 239, blue);
    rectangle(183, 241, 204, 247, blue);
  } else if (name === "ios-add-to-home-screen") {
    rectangle(15, 42, 374, 247, [242, 242, 247]);
    rectangle(37, 62, 352, 115, white);
    rectangle(37, 126, 352, 169, white);
    rectangle(37, 178, 352, 221, white);
    circle(66, 89, 15, blue);
    rectangle(63, 79, 68, 99, white);
    rectangle(57, 85, 74, 90, white);
    rectangle(96, 86, 285, 93, text);
    circle(195, 89, 35, blue);
    circle(195, 89, 31, [242, 242, 247]);
  } else {
    rectangle(24, 22, 365, 237, [197, 219, 255]);
    for (const x of [51, 125, 199, 273]) rectangle(x, 55, x + 51, 106, white);
    rectangle(125, 133, 176, 184, blue);
    rectangle(136, 145, 165, 164, white);
    rectangle(140, 151, 159, 153, blue);
    rectangle(140, 158, 152, 160, blue);
    circle(160, 161, 4, blue);
    rectangle(52, 211, 337, 222, white);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await Promise.all(
  ["ios-share", "ios-add-to-home-screen", "ios-home-screen"].map(async (name) => {
    await writeFile(join(outputDirectory, `${name}.png`), rasterize(name));
  }),
);
