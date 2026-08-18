import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const outputDirectory = join(process.cwd(), "public", "icons");
const splashDirectory = join(process.cwd(), "public", "splash");
const publicDirectory = join(process.cwd(), "public");

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

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const clampedX = Math.max(left + radius, Math.min(x, right - radius));
  const clampedY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - clampedX) ** 2 + (y - clampedY) ** 2 <= radius ** 2;
}

function insideMark(x, y, size) {
  const scale = size / 2;
  const normalizedX = (x + 0.5 - scale) / scale;
  const normalizedY = (y + 0.5 - scale) / scale;
  const dBowl = (normalizedX + 0.28) ** 2 + (normalizedY - 0.08) ** 2;
  const bBowl = (normalizedX - 0.28) ** 2 + (normalizedY - 0.08) ** 2;
  const dRing = dBowl <= 0.2 ** 2 && dBowl >= 0.105 ** 2;
  const bRing = bBowl <= 0.2 ** 2 && bBowl >= 0.105 ** 2;
  const dStem = insideRoundedRect(normalizedX, normalizedY, -0.13, -0.36, -0.03, 0.3, 0.05);
  const bStem = insideRoundedRect(normalizedX, normalizedY, 0.03, -0.36, 0.13, 0.3, 0.05);
  return dRing || bRing || dStem || bStem;
}

function createIcon(size, maskable) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const bgColor = [159, 232, 112, 255];
  const fgColor = [22, 51, 0, 255];
  const center = (size - 1) / 2;
  const circleRadius = size * (maskable ? 0.5 : 0.46);
  const samples = 4;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    pixels[rowStart] = 0; // PNG filter byte (0 = None)

    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;

      let backgroundCoverage = 0;
      let foregroundCoverage = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const sampledX = x + (sampleX + 0.5) / samples;
          const sampledY = y + (sampleY + 0.5) / samples;
          const inCircle =
            maskable || (sampledX - center) ** 2 + (sampledY - center) ** 2 <= circleRadius ** 2;
          if (inCircle) {
            backgroundCoverage += 1;
            if (insideMark(sampledX, sampledY, size)) foregroundCoverage += 1;
          }
        }
      }

      const coverage = samples ** 2;
      const alpha = Math.round((backgroundCoverage / coverage) * 255);
      const foregroundRatio = foregroundCoverage / coverage;
      const [r, g, b] = bgColor.map((value, index) =>
        Math.round(value * (1 - foregroundRatio) + fgColor[index] * foregroundRatio),
      );

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
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

function createSplash(width, height) {
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  const bgColor = [159, 232, 112, 255];
  const fgColor = [22, 51, 0, 255];
  const markSize = Math.min(width, height) * 0.25;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const markTopLeftX = centerX - markSize / 2;
  const markTopLeftY = centerY - markSize / 2;
  const samples = 2;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    pixels[rowStart] = 0;

    const rowInMark = Math.abs(y - centerY) <= markSize / 2 + 2;

    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;

      if (!rowInMark || Math.abs(x - centerX) > markSize / 2 + 2) {
        pixels[offset] = bgColor[0];
        pixels[offset + 1] = bgColor[1];
        pixels[offset + 2] = bgColor[2];
        pixels[offset + 3] = bgColor[3];
        continue;
      }

      let foregroundCoverage = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const sampledX = x + (sampleX + 0.5) / samples;
          const sampledY = y + (sampleY + 0.5) / samples;
          const relX = sampledX - markTopLeftX;
          const relY = sampledY - markTopLeftY;
          if (insideMark(relX, relY, markSize)) {
            foregroundCoverage += 1;
          }
        }
      }

      const coverage = samples ** 2;
      const foregroundRatio = foregroundCoverage / coverage;
      const [r, g, b] = bgColor.map((value, index) =>
        Math.round(value * (1 - foregroundRatio) + fgColor[index] * foregroundRatio),
      );

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = bgColor[3];
    }
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

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directorySize = images.length * 16;
  let offset = header.length + directorySize;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(splashDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });

const faviconSizes = [16, 32, 48, 64, 128, 256];
const splashSizes = [
  [1290, 2796],
  [1179, 2556],
  [1284, 2778],
  [1170, 2532],
  [1125, 2436],
  [1242, 2688],
  [828, 1792],
  [750, 1334],
  [2048, 2732],
  [1668, 2388],
];

await Promise.all([
  writeFile(join(outputDirectory, "icon-192.png"), createIcon(192, false)),
  writeFile(join(outputDirectory, "icon-512.png"), createIcon(512, false)),
  writeFile(join(outputDirectory, "icon-512-maskable.png"), createIcon(512, true)),
  writeFile(join(outputDirectory, "apple-touch-icon.png"), createIcon(180, false)),
  writeFile(
    join(publicDirectory, "favicon.ico"),
    createIco(faviconSizes.map((size) => ({ size, png: createIcon(size, false) }))),
  ),
  ...splashSizes.map(([w, h]) =>
    writeFile(join(splashDirectory, `apple-splash-${w}-${h}.png`), createSplash(w, h)),
  ),
]);
