import { execFile } from "node:child_process";
import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expandRasterJobs, loadBrandManifest, repoRoot } from "./brand-assets";

const execFileAsync = promisify(execFile);

async function main() {
  const manifest = await loadBrandManifest();
  const refresh = process.argv.includes("--refresh");
  const sourcePackageRoot = path.join(repoRoot, manifest.packageRoot);
  const outputArgument = valueAfter("--output");
  const packageRoot = outputArgument ? path.resolve(repoRoot, outputArgument) : sourcePackageRoot;
  if (outputArgument) {
    await rm(packageRoot, { recursive: true, force: true });
    await cp(sourcePackageRoot, packageRoot, { recursive: true });
  }

  for (const job of expandRasterJobs(manifest)) {
    const output = path.join(packageRoot, job.output);
    if (!refresh && await exists(output)) {
      continue;
    }

    await mkdir(path.dirname(output), { recursive: true });
    let pipeline = sharp(path.join(packageRoot, job.source), { density: 384 })
      .resize(job.width, job.height, { fit: "fill" });
    if (!job.alpha) {
      pipeline = pipeline.flatten({ background: manifest.native.androidBackground }).removeAlpha();
    }
    await pipeline.png().toFile(output);
  }

  await exportFavicon(packageRoot, manifest.favicon.source, manifest.favicon.sizes, manifest.favicon.ico, refresh);
  await exportOverview(packageRoot, manifest.overview.output, refresh);
  if (!outputArgument) {
    await syncRuntimeCopies(manifest.packageRoot, manifest.runtimeCopies);
  }
  await exportMacos(packageRoot, manifest.native.macosSource, refresh);
  await exportIos(packageRoot, manifest.native.iosSource, refresh);
  await exportAndroid(packageRoot, manifest.native.androidForegroundSource, manifest.native.androidBackground, refresh);
  await exportWindows(packageRoot, manifest.native.windowsSource, refresh);
  await exportPrint(packageRoot, manifest.native.printLightSource, manifest.native.printDarkSource, refresh);
  console.log(`brand export complete (refresh=${refresh}, output=${path.relative(repoRoot, packageRoot)})`);
}

async function syncRuntimeCopies(packageRoot: string, copies: Array<{ source: string; output: string }>) {
  const sourceRoot = path.join(repoRoot, packageRoot);
  for (const item of copies) {
    const output = path.join(repoRoot, item.output);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(path.join(sourceRoot, item.source), output);
  }
}

async function exportMacos(packageRoot: string, source: string, refresh: boolean) {
  const outputDirectory = path.join(packageRoot, "native/macos");
  const iconset = path.join(outputDirectory, "AreaForge.iconset");
  const icns = path.join(outputDirectory, "AreaForge.icns");
  if (!refresh && await exists(icns)) return;

  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  const sizes = [16, 32, 128, 256, 512];
  for (const size of sizes) {
    await renderSquare(path.join(packageRoot, source), path.join(iconset, `icon_${size}x${size}.png`), size, false);
    await renderSquare(path.join(packageRoot, source), path.join(iconset, `icon_${size}x${size}@2x.png`), size * 2, false);
  }

  if (process.platform === "darwin") {
    await execFileAsync("iconutil", ["-c", "icns", iconset, "-o", icns]);
  }
}

async function exportIos(packageRoot: string, source: string, refresh: boolean) {
  const outputDirectory = path.join(packageRoot, "native/ios/AreaForgeAppIcon.appiconset");
  const contentsPath = path.join(outputDirectory, "Contents.json");
  if (!refresh && await exists(contentsPath)) return;

  await mkdir(outputDirectory, { recursive: true });
  const specs = [
    ["iphone", "20x20", "2x", 40], ["iphone", "20x20", "3x", 60],
    ["iphone", "29x29", "2x", 58], ["iphone", "29x29", "3x", 87],
    ["iphone", "40x40", "2x", 80], ["iphone", "40x40", "3x", 120],
    ["iphone", "60x60", "2x", 120], ["iphone", "60x60", "3x", 180],
    ["ipad", "20x20", "1x", 20], ["ipad", "20x20", "2x", 40],
    ["ipad", "29x29", "1x", 29], ["ipad", "29x29", "2x", 58],
    ["ipad", "40x40", "1x", 40], ["ipad", "40x40", "2x", 80],
    ["ipad", "76x76", "1x", 76], ["ipad", "76x76", "2x", 152],
    ["ipad", "83.5x83.5", "2x", 167], ["ios-marketing", "1024x1024", "1x", 1024],
  ] as const;
  const images = [];
  for (const [idiom, size, scale, pixels] of specs) {
    const filename = `areaforge-${idiom}-${size.replaceAll(".", "_")}-${scale}.png`;
    await renderSquare(path.join(packageRoot, source), path.join(outputDirectory, filename), pixels, false);
    images.push({ idiom, size, scale, filename });
  }
  await writeFile(contentsPath, `${JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2)}\n`);
}

async function exportAndroid(packageRoot: string, source: string, background: string, refresh: boolean) {
  const outputDirectory = path.join(packageRoot, "native/android/res");
  const drawableDirectory = path.join(outputDirectory, "drawable-nodpi");
  const valuesDirectory = path.join(outputDirectory, "values");
  const mipmapDirectory = path.join(outputDirectory, "mipmap-anydpi-v26");
  const foreground = path.join(drawableDirectory, "areaforge_adaptive_foreground.png");
  if (!refresh && await exists(foreground)) return;

  await mkdir(drawableDirectory, { recursive: true });
  await mkdir(valuesDirectory, { recursive: true });
  await mkdir(mipmapDirectory, { recursive: true });
  const foregroundBuffer = await sharp(path.join(packageRoot, source))
    .resize(286, 286, { fit: "contain" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 432, height: 432, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: foregroundBuffer, left: 73, top: 73 }]).png().toFile(foreground);
  await sharp({ create: { width: 432, height: 432, channels: 3, background } })
    .png()
    .toFile(path.join(drawableDirectory, "areaforge_adaptive_background.png"));
  await writeFile(path.join(valuesDirectory, "colors.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="areaforge_icon_background">${background}</color>\n</resources>\n`);
  const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/areaforge_icon_background" />\n  <foreground android:drawable="@drawable/areaforge_adaptive_foreground" />\n</adaptive-icon>\n`;
  await writeFile(path.join(mipmapDirectory, "ic_launcher.xml"), adaptiveIcon);
  await writeFile(path.join(mipmapDirectory, "ic_launcher_round.xml"), adaptiveIcon);
}

async function exportFavicon(packageRoot: string, source: string, sizes: number[], icoPath: string, refresh: boolean) {
  const output = path.join(packageRoot, icoPath);
  if (!refresh && await exists(output)) return;
  const images = await Promise.all(sizes.map((size) => sharp(path.join(packageRoot, source), { density: 384 }).resize(size, size).png().toBuffer()));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, buildIco(sizes, images));
}

async function exportOverview(packageRoot: string, outputPath: string, refresh: boolean) {
  const output = path.join(packageRoot, outputPath);
  if (!refresh && await exists(output)) return;

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
    <rect width="1600" height="1200" fill="#EFF8F5"/>
    <rect width="1600" height="126" fill="#082E31"/>
    <text x="62" y="86" fill="#F4FBF8" font-family="Arial, sans-serif" font-size="58" font-weight="700">AreaForge Brand System</text>
    <text x="1180" y="72" fill="#8DE2D2" font-family="Arial, sans-serif" font-size="20">DIGITAL ASSET KIT</text>
    <g fill="#FFFFFF"><rect x="50" y="160" width="700" height="250" rx="8"/><rect x="50" y="450" width="960" height="270" rx="8"/><rect x="50" y="760" width="700" height="380" rx="8"/></g>
    <rect x="390" y="835" width="330" height="285" rx="8" fill="#082E31"/>
    <g fill="#082E31"><rect x="800" y="160" width="750" height="250" rx="8"/><rect x="1050" y="450" width="500" height="270" rx="8"/><rect x="800" y="760" width="750" height="380" rx="8"/></g>
    <g font-family="Arial, sans-serif" font-size="25" font-weight="700"><text x="76" y="205" fill="#082E31">APP ICONS &amp; SYMBOLS</text><text x="826" y="205" fill="#F4FBF8">DARK BACKGROUND</text><text x="76" y="495" fill="#082E31">HORIZONTAL LOCKUPS</text><text x="1076" y="495" fill="#F4FBF8">MONO</text><text x="76" y="805" fill="#082E31">STACKED</text><text x="826" y="805" fill="#F4FBF8">SOCIAL PREVIEW</text></g>
  </svg>`);
  const assets = [
    { input: "app-icon/areaforge-app-icon-light-256.png", left: 92, top: 225, width: 160, height: 160 },
    { input: "app-icon/areaforge-app-icon-dark-256.png", left: 275, top: 225, width: 160, height: 160 },
    { input: "symbol/areaforge-logo-symbol-light-256.png", left: 470, top: 235, width: 140, height: 140 },
    { input: "symbol/areaforge-logo-symbol-light-256.png", left: 1000, top: 230, width: 145, height: 145 },
    { input: "app-icon/areaforge-app-icon-dark-256.png", left: 1185, top: 225, width: 160, height: 160 },
    { input: "lockup/areaforge-logo-lockup-light-1600x520.png", left: 290, top: 530, width: 560, height: 182 },
    { input: "lockup/areaforge-logo-lockup-mono-light-1600x520.png", left: 1100, top: 550, width: 390, height: 127 },
    { input: "stacked/areaforge-logo-stacked-light-1024.png", left: 125, top: 850, width: 250, height: 250 },
    { input: "stacked/areaforge-logo-stacked-dark-1024.png", left: 425, top: 835, width: 285, height: 285 },
    { input: "social/areaforge-social-preview-dark.png", left: 925, top: 850, width: 520, height: 273 },
  ];
  const composites = await Promise.all(assets.map(async ({ input, left, top, width, height }) => ({
    input: await sharp(path.join(packageRoot, input)).resize(width, height, { fit: "contain" }).png().toBuffer(),
    left,
    top,
  })));
  await sharp(svg).composite(composites).png().toFile(output);
}

async function exportWindows(packageRoot: string, source: string, refresh: boolean) {
  const outputDirectory = path.join(packageRoot, "native/windows");
  const output = path.join(outputDirectory, "AreaForge.ico");
  if (!refresh && await exists(output)) return;

  await mkdir(outputDirectory, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map((size) => sharp(path.join(packageRoot, source)).resize(size, size).png().toBuffer()));
  await writeFile(output, buildIco(sizes, images));
}

async function exportPrint(packageRoot: string, lightSource: string, darkSource: string, refresh: boolean) {
  const outputDirectory = path.join(packageRoot, "print");
  const lightPdf = path.join(outputDirectory, "areaforge-logo-light-background.pdf");
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(path.join(packageRoot, lightSource), path.join(outputDirectory, "areaforge-logo-light-background.svg"));
  await copyFile(path.join(packageRoot, darkSource), path.join(outputDirectory, "areaforge-logo-dark-background.svg"));

  if (refresh || !await exists(path.join(outputDirectory, "areaforge-logo-light-background-cmyk.tiff"))) {
    await sharp(path.join(packageRoot, lightSource), { density: 300 })
      .resize(3600, 1170)
      .flatten({ background: "#FFFFFF" })
      .toColourspace("cmyk")
      .tiff({ compression: "lzw", resolutionUnit: "inch", xres: 300, yres: 300 })
      .toFile(path.join(outputDirectory, "areaforge-logo-light-background-cmyk.tiff"));
  }
  if (refresh || !await exists(path.join(outputDirectory, "areaforge-logo-dark-background-cmyk.tiff"))) {
    await sharp(path.join(packageRoot, darkSource), { density: 300 })
      .resize(3600, 1170)
      .flatten({ background: "#06191F" })
      .toColourspace("cmyk")
      .tiff({ compression: "lzw", resolutionUnit: "inch", xres: 300, yres: 300 })
      .toFile(path.join(outputDirectory, "areaforge-logo-dark-background-cmyk.tiff"));
  }

  if (process.platform === "darwin" && (refresh || !await exists(lightPdf))) {
    await execFileAsync("sips", ["-s", "format", "pdf", path.join(packageRoot, lightSource), "--out", lightPdf]);
    const darkComposite = path.join(outputDirectory, ".areaforge-logo-dark-background.svg");
    const darkSvg = await readFile(path.join(packageRoot, darkSource), "utf8");
    const innerSvg = darkSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    await writeFile(darkComposite, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 520"><rect width="1600" height="520" fill="#06191F"/>${innerSvg}</svg>\n`);
    await execFileAsync("sips", ["-s", "format", "pdf", darkComposite, "--out", path.join(outputDirectory, "areaforge-logo-dark-background.pdf")]);
    await rm(darkComposite, { force: true });
  }
}

async function renderSquare(source: string, output: string, size: number, alpha: boolean) {
  let pipeline = sharp(source, { density: 384 }).resize(size, size, { fit: "fill" });
  if (!alpha) pipeline = pipeline.flatten({ background: "#06191F" }).removeAlpha();
  await pipeline.png().toFile(output);
}

function buildIco(sizes: number[], images: Buffer[]): Buffer {
  const headerSize = 6 + sizes.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = headerSize;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index];
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

await main();
