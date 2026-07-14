import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { expandRasterJobs, loadBrandManifest, repoRoot } from "../brand/brand-assets";

async function main() {
  const manifest = await loadBrandManifest();
  const rootArgument = valueAfter("--root");
  const packageRoot = rootArgument ? path.resolve(repoRoot, rootArgument) : path.join(repoRoot, manifest.packageRoot);
  const errors: string[] = [];

  for (const job of expandRasterJobs(manifest)) {
    await validateRaster(path.join(packageRoot, job.output), job.width, job.height, job.alpha, errors);
    await requireFile(path.join(packageRoot, job.source), errors);
  }

  await validateRaster(
    path.join(packageRoot, manifest.overview.output),
    manifest.overview.width,
    manifest.overview.height,
    true,
    errors,
  );
  await requireFile(path.join(packageRoot, manifest.favicon.ico), errors);
  await validateIco(path.join(packageRoot, manifest.favicon.ico), manifest.favicon.sizes, errors);

  if (!rootArgument) {
    for (const item of manifest.runtimeCopies) {
      const source = path.join(packageRoot, item.source);
      const output = path.join(repoRoot, item.output);
      await requireFile(source, errors);
      await requireFile(output, errors);
      if (await exists(source) && await exists(output) && await sha256(source) !== await sha256(output)) {
        errors.push(`runtime copy drift: ${item.output}`);
      }
    }
  }

  await validateNative(packageRoot, errors);
  await validateNoMetadataFiles(packageRoot, errors);

  if (errors.length > 0) {
    console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  const runtimeSummary = rootArgument ? "runtime copies skipped for alternate root" : `${manifest.runtimeCopies.length} runtime copies`;
  console.log(`brand assets valid: ${expandRasterJobs(manifest).length} raster exports, ${runtimeSummary}, native and print deliverables present`);
}

async function validateRaster(file: string, width: number, height: number, alpha: boolean, errors: string[]) {
  if (!await exists(file)) {
    errors.push(`missing raster: ${path.relative(repoRoot, file)}`);
    return;
  }
  const metadata = await sharp(file).metadata();
  if (metadata.width !== width || metadata.height !== height) {
    errors.push(`wrong dimensions: ${path.relative(repoRoot, file)} expected ${width}x${height}, got ${metadata.width}x${metadata.height}`);
  }
  if (Boolean(metadata.hasAlpha) !== alpha) {
    errors.push(`wrong alpha mode: ${path.relative(repoRoot, file)} expected alpha=${alpha}, got ${Boolean(metadata.hasAlpha)}`);
  }
}

async function validateNative(packageRoot: string, errors: string[]) {
  const required = [
    "native/README.md",
    "native/macos/AreaForge.icns",
    "native/ios/AreaForgeAppIcon.appiconset/Contents.json",
    "native/android/res/drawable-nodpi/areaforge_adaptive_foreground.png",
    "native/android/res/drawable-nodpi/areaforge_adaptive_background.png",
    "native/android/res/values/colors.xml",
    "native/android/res/mipmap-anydpi-v26/ic_launcher.xml",
    "native/android/res/mipmap-anydpi-v26/ic_launcher_round.xml",
    "native/windows/AreaForge.ico",
    "print/README.md",
    "print/areaforge-logo-light-background.svg",
    "print/areaforge-logo-dark-background.svg",
    "print/areaforge-logo-light-background.pdf",
    "print/areaforge-logo-dark-background.pdf",
    "print/areaforge-logo-light-background-cmyk.tiff",
    "print/areaforge-logo-dark-background-cmyk.tiff"
  ];
  for (const file of required) await requireFile(path.join(packageRoot, file), errors);

  for (const size of [16, 32, 128, 256, 512]) {
    await validateRaster(path.join(packageRoot, `native/macos/AreaForge.iconset/icon_${size}x${size}.png`), size, size, false, errors);
    await validateRaster(path.join(packageRoot, `native/macos/AreaForge.iconset/icon_${size}x${size}@2x.png`), size * 2, size * 2, false, errors);
  }
  await validateMagic(path.join(packageRoot, "native/macos/AreaForge.icns"), "icns", errors);
  await validateIosAppIconSet(path.join(packageRoot, "native/ios/AreaForgeAppIcon.appiconset"), errors);
  await validateRaster(path.join(packageRoot, "native/android/res/drawable-nodpi/areaforge_adaptive_foreground.png"), 432, 432, true, errors);
  await validateRaster(path.join(packageRoot, "native/android/res/drawable-nodpi/areaforge_adaptive_background.png"), 432, 432, false, errors);
  await validateIco(path.join(packageRoot, "native/windows/AreaForge.ico"), [16, 24, 32, 48, 64, 128, 256], errors);
  await validateMagic(path.join(packageRoot, "print/areaforge-logo-light-background.pdf"), "%PDF", errors);
  await validateMagic(path.join(packageRoot, "print/areaforge-logo-dark-background.pdf"), "%PDF", errors);
  await validatePrintTiff(path.join(packageRoot, "print/areaforge-logo-light-background-cmyk.tiff"), errors);
  await validatePrintTiff(path.join(packageRoot, "print/areaforge-logo-dark-background-cmyk.tiff"), errors);
}

async function validateIosAppIconSet(directory: string, errors: string[]) {
  const contentsPath = path.join(directory, "Contents.json");
  if (!await exists(contentsPath)) return;
  const contents = JSON.parse(await readFile(contentsPath, "utf8")) as {
    images?: Array<{ filename?: string; size?: string; scale?: string }>;
  };
  if (!contents.images || contents.images.length !== 18) {
    errors.push(`iOS AppIcon expected 18 slots, got ${contents.images?.length ?? 0}`);
    return;
  }
  for (const image of contents.images) {
    if (!image.filename || !image.size || !image.scale) {
      errors.push("iOS AppIcon entry is incomplete");
      continue;
    }
    const points = Number.parseFloat(image.size.split("x")[0]);
    const scale = Number.parseInt(image.scale, 10);
    const pixels = Math.round(points * scale);
    await validateRaster(path.join(directory, image.filename), pixels, pixels, false, errors);
  }
}

async function validateIco(file: string, expectedSizes: number[], errors: string[]) {
  if (!await exists(file)) return;
  const buffer = await readFile(file);
  if (buffer.length < 6 || buffer.readUInt16LE(2) !== 1) {
    errors.push(`invalid ICO header: ${path.relative(repoRoot, file)}`);
    return;
  }
  const count = buffer.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, index) => {
    const value = buffer.readUInt8(6 + index * 16);
    return value === 0 ? 256 : value;
  });
  if (sizes.join(",") !== expectedSizes.join(",")) {
    errors.push(`wrong ICO sizes: ${path.relative(repoRoot, file)} expected ${expectedSizes.join(",")}, got ${sizes.join(",")}`);
  }
}

async function validateMagic(file: string, magic: string, errors: string[]) {
  if (!await exists(file)) return;
  const buffer = await readFile(file);
  if (buffer.subarray(0, magic.length).toString("ascii") !== magic) {
    errors.push(`wrong file signature: ${path.relative(repoRoot, file)}`);
  }
}

async function validatePrintTiff(file: string, errors: string[]) {
  if (!await exists(file)) return;
  const metadata = await sharp(file).metadata();
  if (metadata.width !== 3600 || metadata.height !== 1170 || metadata.space !== "cmyk") {
    errors.push(`invalid print TIFF: ${path.relative(repoRoot, file)} expected 3600x1170 CMYK, got ${metadata.width}x${metadata.height} ${metadata.space}`);
  }
}

async function validateNoMetadataFiles(directory: string, errors: string[]) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if ([".DS_Store", "Thumbs.db"].includes(entry.name) || entry.name.endsWith("~")) {
      errors.push(`metadata file present: ${entry.name}`);
    }
  }
}

async function requireFile(file: string, errors: string[]) {
  if (!await exists(file)) errors.push(`missing file: ${path.relative(repoRoot, file)}`);
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
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
