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

// Minimal 5x7 font bitmasks for lowercase 'd' and 'b'
const FONT_5X7 = {
  d: [
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 1, 1, 0, 1],
    [1, 0, 0, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 1, 1],
    [0, 1, 1, 0, 1],
  ],
  b: [
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 1, 1, 0],
    [1, 1, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 0, 1, 1, 0],
  ],
};

function createIcon(size, maskable) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);

  // Background colors: Primary green (#9fe870 -> [159, 232, 112]), Dark text (#163300 -> [22, 51, 0])
  const bgColor = [159, 232, 112, 255];
  const fgColor = [22, 51, 0, 255];

  // Circle dimensions
  const center = (size - 1) / 2;
  // Maskable icons use 40% radius (80% diameter) to stay within safe zone; standard icons use ~45% radius
  const circleRadius = size * (maskable ? 0.4 : 0.45);

  // Text scaling parameters
  const fontGridHeight = 7;
  const fontGridWidth = 5;
  const letterSpacing = 1;

  // Total text width in grid units: 5 ('d') + 1 (space) + 5 ('b') = 11 units
  const totalGridWidth = fontGridWidth * 2 + letterSpacing;

  // Scale pixels per font grid cell based on icon size
  const scale = size * 0.055;
  const textPixelWidth = totalGridWidth * scale;
  const textPixelHeight = fontGridHeight * scale;

  const textStartX = center - textPixelWidth / 2;
  const textStartY = center - textPixelHeight / 2;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    pixels[rowStart] = 0; // PNG filter byte (0 = None)

    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;

      // Check distance from center for the green circle
      const distFromCenterSq = (x - center) ** 2 + (y - center) ** 2;
      const inCircle = distFromCenterSq <= circleRadius ** 2;

      let isTextPixel = false;

      if (
        inCircle &&
        x >= textStartX &&
        x < textStartX + textPixelWidth &&
        y >= textStartY &&
        y < textStartY + textPixelHeight
      ) {
        const gridX = (x - textStartX) / scale;
        const gridY = (y - textStartY) / scale;

        const charRow = Math.floor(gridY);

        if (charRow >= 0 && charRow < fontGridHeight) {
          let charMatrix = null;
          let colInChar = -1;

          if (gridX < fontGridWidth) {
            // Letter 'd'
            charMatrix = FONT_5X7.d;
            colInChar = Math.floor(gridX);
          } else if (gridX >= fontGridWidth + letterSpacing && gridX < totalGridWidth) {
            // Letter 'b'
            charMatrix = FONT_5X7.b;
            colInChar = Math.floor(gridX - (fontGridWidth + letterSpacing));
          }

          if (charMatrix && colInChar >= 0 && colInChar < fontGridWidth) {
            if (charMatrix[charRow][colInChar] === 1) {
              isTextPixel = true;
            }
          }
        }
      }

      const [r, g, b, a] = inCircle ? (isTextPixel ? fgColor : bgColor) : [0, 0, 0, 0];

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = a;
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
