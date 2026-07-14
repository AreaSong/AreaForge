import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RasterJob = {
  source: string;
  output: string;
  width: number;
  height: number;
  alpha: boolean;
};

type ThemedSquareFamily = {
  id: string;
  source: string;
  smallSource?: string;
  smallSizes?: number[];
  sizes: number[];
  output: string;
  alpha: boolean;
};

export type BrandManifest = {
  schemaVersion: number;
  brand: string;
  packageRoot: string;
  themes: string[];
  themedSquareFamilies: ThemedSquareFamily[];
  fixedRasterExports: RasterJob[];
  favicon: {
    source: string;
    sizes: number[];
    output: string;
    ico: string;
  };
  overview: {
    output: string;
    width: number;
    height: number;
  };
  runtimeCopies: Array<{ source: string; output: string }>;
  native: {
    macosSource: string;
    iosSource: string;
    androidForegroundSource: string;
    androidBackground: string;
    windowsSource: string;
    printLightSource: string;
    printDarkSource: string;
    printDpi: number;
  };
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDirectory, "../..");
export const manifestPath = path.join(repoRoot, "assets/brand/brand-manifest.json");

export async function loadBrandManifest(): Promise<BrandManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as BrandManifest;
}

export function expandRasterJobs(manifest: BrandManifest): RasterJob[] {
  const jobs = manifest.themedSquareFamilies.flatMap((family) =>
    manifest.themes.flatMap((theme) =>
      family.sizes.map((size) => ({
        source: selectSource(family, theme, size),
        output: replaceTokens(family.output, theme, size),
        width: size,
        height: size,
        alpha: family.alpha,
      })),
    ),
  );

  const favicons = manifest.favicon.sizes.map((size) => ({
    source: manifest.favicon.source,
    output: manifest.favicon.output.replaceAll("{size}", String(size)),
    width: size,
    height: size,
    alpha: true,
  }));

  return [...jobs, ...manifest.fixedRasterExports, ...favicons];
}

function selectSource(family: ThemedSquareFamily, theme: string, size: number): string {
  const useSmallSource = family.smallSource && family.smallSizes?.includes(size);
  return replaceTokens(useSmallSource ? family.smallSource : family.source, theme, size);
}

function replaceTokens(value: string, theme: string, size: number): string {
  return value.replaceAll("{theme}", theme).replaceAll("{size}", String(size));
}
