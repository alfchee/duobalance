import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const outputDirectory = join(process.cwd(), "public", "icons");

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

function createIcon(size, maskable) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const radius = maskable ? 0 : Math.round(size * 0.21);
  const inset = Math.round(size * (maskable ? 0.25 : 0.22));
  const cardLeft = inset;
  const cardTop = Math.round(size * 0.32);
  const cardRight = size - inset;
  const cardBottom = Math.round(size * 0.69);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    pixels[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const inRoundedSquare =
        radius === 0 ||
        (x >= radius && x < size - radius) ||
        (y >= radius && y < size - radius) ||
        (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2 ||
        (x - (size - radius - 1)) ** 2 + (y - radius) ** 2 <= radius ** 2 ||
        (x - radius) ** 2 + (y - (size - radius - 1)) ** 2 <= radius ** 2 ||
        (x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2 <= radius ** 2;
      const inCard = x >= cardLeft && x <= cardRight && y >= cardTop && y <= cardBottom;
      const inFirstLine =
        x >= Math.round(size * 0.3) &&
        x <= Math.round(size * 0.69) &&
        y >= Math.round(size * 0.41) &&
        y <= Math.round(size * 0.47);
      const inSecondLine =
        x >= Math.round(size * 0.3) &&
        x <= Math.round(size * 0.55) &&
        y >= Math.round(size * 0.54) &&
        y <= Math.round(size * 0.6);
      const inCircle =
        (x - Math.round(size * 0.68)) ** 2 + (y - Math.round(size * 0.57)) ** 2 <=
        Math.round(size * 0.06) ** 2;
      const [red, green, blue, alpha] = inRoundedSquare
        ? inCard
          ? inFirstLine || inSecondLine || inCircle
            ? [52, 120, 212, 255]
            : [255, 255, 255, 255]
          : [52, 120, 212, 255]
        : [0, 0, 0, 0];
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "icon-192.png"), createIcon(192, false)),
  writeFile(join(outputDirectory, "icon-512.png"), createIcon(512, false)),
  writeFile(join(outputDirectory, "icon-512-maskable.png"), createIcon(512, true)),
  writeFile(join(outputDirectory, "apple-touch-icon.png"), createIcon(180, false)),
]);
