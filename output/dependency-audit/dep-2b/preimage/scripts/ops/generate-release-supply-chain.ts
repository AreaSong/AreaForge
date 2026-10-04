import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PnpmListPackage {
  name?: string;
  from?: string;
  version?: string;
  path?: string;
  private?: boolean;
  resolved?: string;
  dependencies?: Record<string, PnpmListPackage>;
}

interface SbomPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  downloadLocation: string;
  filesAnalyzed: false;
  licenseConcluded: string;
  licenseDeclared: string;
  copyrightText: string;
  supplier: string;
  externalRefs: Array<{
    referenceCategory: "PACKAGE-MANAGER";
    referenceType: "purl";
    referenceLocator: string;
  }>;
}

interface Relationship {
  spdxElementId: string;
  relationshipType: "DESCRIBES" | "DEPENDS_ON" | "GENERATED_FROM";
  relatedSpdxElement: string;
}

const root = process.cwd();
const packageFiles = [
  "package.json",
  "apps/web/package.json",
  "packages/ai/package.json",
  "packages/auth/package.json",
  "packages/config/package.json",
  "packages/core/package.json",
  "packages/db/package.json",
  "packages/storage/package.json",
  "packages/ui/package.json",
] as const;

const releaseTag = process.env.AREAFORGE_RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? "local";
const releaseVersion = process.env.AREAFORGE_RELEASE_VERSION ?? versionFromTag(releaseTag) ?? readPackageJson("package.json").version ?? "0.0.0";
const gitCommit = process.env.AREAFORGE_GIT_COMMIT ?? process.env.GITHUB_SHA ?? localGitCommit();
const generatedAt = process.env.AREAFORGE_RELEASE_GENERATED_AT ?? new Date().toISOString();
const sbomPath = process.env.AREAFORGE_SBOM_PATH ?? "areaforge-sbom.spdx.json";
const provenancePath = process.env.AREAFORGE_PROVENANCE_PATH ?? "areaforge-provenance.json";

function main(): void {
  const workspaceManifests = readWorkspaceManifests();
  const listedPackages = readPnpmProdList();
  const packages = new Map<string, SbomPackage>();
  const relationships = new Map<string, Relationship>();

  for (const item of listedPackages) {
    collectPackage(item, workspaceManifests, packages, relationships);
  }

  const rootManifest = readPackageJson("package.json");
  const rootPackageId = packageId(rootManifest.name ?? "areaforge", releaseVersion);
  packages.set(rootPackageId, buildSbomPackage({
    name: rootManifest.name ?? "areaforge",
    version: releaseVersion,
    resolved: null,
    license: rootManifest.license,
    isWorkspace: true,
  }));
  relationships.set(`DESCRIBES:${rootPackageId}`, {
    spdxElementId: "SPDXRef-DOCUMENT",
    relationshipType: "DESCRIBES",
    relatedSpdxElement: rootPackageId,
  });

  const sbom = buildSbom([...packages.values()], [...relationships.values()]);
  writeJson(sbomPath, sbom);

  const provenance = buildProvenance(sbomPath);
  writeJson(provenancePath, provenance);

  console.log(`release supply-chain assets generated: ${sbomPath}, ${provenancePath}`);
  console.log(`sbomPackageCount: ${packages.size}`);
  console.log(`sbomSha256: ${sha256File(sbomPath)}`);
  console.log(`provenanceSha256: ${sha256File(provenancePath)}`);
}

function collectPackage(
  item: PnpmListPackage,
  workspaceManifests: Map<string, PackageJson>,
  packages: Map<string, SbomPackage>,
  relationships: Map<string, Relationship>,
  fallbackName?: string,
): string | null {
  const name = item.name ?? item.from ?? fallbackName;
  if (!name) return null;
  const workspaceManifest = workspaceManifests.get(name);
  const version = normalizeVersion(item.version, workspaceManifest);
  const id = packageId(name, version);
  if (!packages.has(id)) {
    packages.set(id, buildSbomPackage({
      name,
      version,
      resolved: normalizeResolved(item.resolved),
      license: workspaceManifest?.license ?? licenseFromInstalledPackage(item.path),
      isWorkspace: Boolean(workspaceManifest),
    }));
  }

  for (const [dependencyName, dependency] of Object.entries(item.dependencies ?? {})) {
    const dependencyId = collectPackage(dependency, workspaceManifests, packages, relationships, dependencyName);
    if (dependencyId) {
      relationships.set(`${id}->${dependencyId}`, {
        spdxElementId: id,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: dependencyId,
      });
    }
  }

  return id;
}

function buildSbomPackage(input: {
  name: string;
  version: string;
  resolved: string | null;
  license?: string;
  isWorkspace: boolean;
}): SbomPackage {
  return {
    SPDXID: packageId(input.name, input.version),
    name: input.name,
    versionInfo: input.version,
    downloadLocation: input.resolved ?? "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: input.license?.trim() || "NOASSERTION",
    copyrightText: "NOASSERTION",
    supplier: input.isWorkspace ? "Organization: AreaSong" : "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: npmPurl(input.name, input.version),
      },
    ],
  };
}

function buildSbom(packages: SbomPackage[], relationships: Relationship[]) {
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `AreaForge ${releaseTag} application dependency SBOM`,
    documentNamespace: `https://github.com/AreaSong/AreaForge/releases/download/${releaseTag}/areaforge-sbom-${gitCommit}.spdx.json`,
    creationInfo: {
      created: generatedAt,
      creators: [
        "Tool: AreaForge release supply-chain generator",
        "Organization: AreaSong",
      ],
    },
    packages: packages.sort((a, b) => a.SPDXID.localeCompare(b.SPDXID)),
    relationships: relationships.sort((a, b) =>
      `${a.spdxElementId}:${a.relationshipType}:${a.relatedSpdxElement}`.localeCompare(
        `${b.spdxElementId}:${b.relationshipType}:${b.relatedSpdxElement}`,
      ),
    ),
  };
}

function buildProvenance(sbomAsset: string) {
  const webImage = process.env.AREAFORGE_WEB_IMAGE ?? null;
  const webImageDigest = process.env.AREAFORGE_WEB_IMAGE_DIGEST ?? null;
  const migrationImage = process.env.AREAFORGE_MIGRATION_IMAGE ?? null;
  const migrationImageDigest = process.env.AREAFORGE_MIGRATION_IMAGE_DIGEST ?? null;
  return {
    schemaVersion: 1,
    statementType: "areaforge.release.provenance",
    generatedAt,
    release: {
      tag: releaseTag,
      version: releaseVersion,
      channel: process.env.AREAFORGE_RELEASE_CHANNEL ?? process.env.CHANNEL ?? "stable",
      gitCommit,
      repository: process.env.GITHUB_REPOSITORY ?? "AreaSong/AreaForge",
      workflow: process.env.GITHUB_WORKFLOW ?? "release",
      workflowRunId: process.env.GITHUB_RUN_ID ?? null,
      workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      refName: process.env.GITHUB_REF_NAME ?? releaseTag,
    },
    subjects: [
      subject("webImage", webImage, webImageDigest),
      subject("migrationImage", migrationImage, migrationImageDigest),
      {
        name: "areaforge-release-manifest.json",
        digest: fileDigestIfExists("areaforge-release-manifest.json"),
      },
      {
        name: "docker-compose.prod.yml",
        digest: fileDigestIfExists("docker-compose.prod.yml"),
      },
      {
        name: sbomAsset,
        digest: fileDigestIfExists(sbomAsset),
      },
    ],
    build: {
      nodeVersion: "24",
      packageManager: readPackageJson("package.json").packageManager ?? "pnpm",
      lockfileSha256: sha256File("pnpm-lock.yaml"),
      dockerfiles: [
        {
          name: "web",
          path: "infra/docker/web.Dockerfile",
          sha256: sha256File("infra/docker/web.Dockerfile"),
        },
        {
          name: "migration",
          path: "infra/docker/migration.Dockerfile",
          sha256: sha256File("infra/docker/migration.Dockerfile"),
        },
      ],
      validationGate: "release workflow validate job",
      artifactIntegrity: "areaforge-provenance.json and areaforge-sbom.spdx.json are included in SHA256SUMS and covered by SHA256SUMS.sig",
    },
    safetyFacts: {
      secretsIncluded: false,
      productionEnvIncluded: false,
      backupIncluded: false,
      promptOrRawAiResponseIncluded: false,
      attachmentContentIncluded: false,
    },
  };
}

function subject(name: string, image: string | null, digest: string | null) {
  return {
    name,
    image,
    digest,
  };
}

function readPnpmProdList(): PnpmListPackage[] {
  const output = execFileSync("pnpm", ["list", "--json", "--recursive", "--prod", "--depth", "Infinity"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as PnpmListPackage[];
}

function readWorkspaceManifests(): Map<string, PackageJson> {
  const manifests = new Map<string, PackageJson>();
  for (const file of packageFiles) {
    const manifest = readPackageJson(file);
    if (manifest.name) manifests.set(manifest.name, manifest);
  }
  return manifests;
}

function readPackageJson(file: string): PackageJson {
  return JSON.parse(readFileSync(path.join(root, file), "utf8")) as PackageJson;
}

function normalizeVersion(version: string | undefined, workspaceManifest: PackageJson | undefined): string {
  if (workspaceManifest?.version) return workspaceManifest.version;
  if (!version || version.startsWith("link:") || version.startsWith("workspace:")) return "NOASSERTION";
  return version;
}

function normalizeResolved(value: string | undefined): string | null {
  if (!value || value.startsWith("link:")) return null;
  return /^https?:\/\//.test(value) ? value : null;
}

function licenseFromInstalledPackage(packagePath: string | undefined): string | undefined {
  if (!packagePath) return undefined;
  const manifestPath = path.join(packagePath, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageJson;
    return manifest.license;
  } catch {
    return undefined;
  }
}

function packageId(name: string, version: string): string {
  return `SPDXRef-Package-${sanitize(`${name}-${version}`)}`;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, "-").replace(/-+/g, "-");
}

function npmPurl(name: string, version: string): string {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function versionFromTag(tag: string): string | null {
  const match = tag.match(/^v?(.+)$/);
  return match?.[1] ?? null;
}

function localGitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function fileDigestIfExists(file: string): { sha256: string } | null {
  return existsSync(resolvePath(file)) ? { sha256: sha256File(file) } : null;
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(resolvePath(file))).digest("hex");
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(resolvePath(file), `${JSON.stringify(data, null, 2)}\n`);
}

function resolvePath(file: string): string {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

main();
