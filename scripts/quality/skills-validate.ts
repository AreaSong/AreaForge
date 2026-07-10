import fs from "node:fs";
import path from "node:path";

type SkillMeta = {
  name?: string;
  description?: string;
};

const root = process.cwd();
const skillsRoot = path.join(root, ".codex", "skills-src");
const agentSkillsRoot = path.join(root, ".agents", "skills");
const skillsReadme = path.join(skillsRoot, "README.md");

const requiredSkills = [
  "areaforge-enterprise-governance",
  "areaforge-operating-loop",
  "areaforge-release-operator",
  "areaforge-qa-smoke",
  "areaforge-doc-sync",
  "areaforge-git-checkpoint",
  "areaforge-sre-ops",
  "areaforge-observability",
  "areaforge-incident-response",
  "areaforge-security-governance",
  "areaforge-supply-chain",
  "areaforge-residual-ledger",
  "areaforge-product-experience",
  "areaforge-ai-governance",
  "areaforge-validation-driver",
];

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`PASS ${message}`);
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function parseFrontmatter(markdown: string): SkillMeta {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail("SKILL.md missing YAML frontmatter");
  }

  const meta: SkillMeta = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!field) {
      continue;
    }
    const value = field[2].trim().replace(/^"|"$/g, "");
    if (field[1] === "name") {
      meta.name = value;
    }
    if (field[1] === "description") {
      meta.description = value;
    }
  }

  return meta;
}

function referencedReferenceFiles(markdown: string): string[] {
  const refs = new Set<string>();
  const linkPattern = /\]\((references\/[^)]+)\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    refs.add(match[1]);
  }
  return [...refs];
}

if (!fs.existsSync(skillsRoot)) {
  fail(".codex/skills-src missing");
}
if (!fs.existsSync(skillsReadme)) {
  fail(".codex/skills-src/README.md missing");
}

const skillsReadmeContent = read(skillsReadme);

for (const skill of requiredSkills) {
  const skillDir = path.join(skillsRoot, skill);
  const skillFile = path.join(skillDir, "SKILL.md");
  const openaiFile = path.join(skillDir, "agents", "openai.yaml");
  const agentEntry = path.join(agentSkillsRoot, skill);

  if (!fs.existsSync(skillFile)) {
    fail(`${skill} missing SKILL.md`);
  }

  const markdown = read(skillFile);
  const meta = parseFrontmatter(markdown);
  if (meta.name !== skill) {
    fail(`${skill} frontmatter name mismatch`);
  }
  if (!meta.description || meta.description.length < 80 || meta.description.includes("TODO")) {
    fail(`${skill} frontmatter description is incomplete`);
  }
  if (markdown.includes("[TODO") || markdown.includes("Structuring This Skill")) {
    fail(`${skill} still contains template TODO text`);
  }

  for (const ref of referencedReferenceFiles(markdown)) {
    const refPath = path.join(skillDir, ref);
    if (!fs.existsSync(refPath)) {
      fail(`${skill} references missing file ${ref}`);
    }
  }

  if (!fs.existsSync(openaiFile)) {
    fail(`${skill} missing agents/openai.yaml`);
  }
  const openaiYaml = read(openaiFile);
  if (!openaiYaml.includes(`Use $${skill}`)) {
    fail(`${skill} openai.yaml default_prompt must mention $${skill}`);
  }
  for (const token of ["interface:", "display_name:", "short_description:", "default_prompt:"]) {
    if (!openaiYaml.includes(token)) {
      fail(`${skill} openai.yaml missing ${token}`);
    }
  }

  if (!skillsReadmeContent.includes(`- \`${skill}\``)) {
    fail(`${skill} missing from .codex/skills-src/README.md current skills list`);
  }
  if (!skillsReadmeContent.includes(`| \`${skill}\` |`)) {
    fail(`${skill} missing from .codex/skills-src/README.md owner table`);
  }

  if (!fs.existsSync(agentEntry)) {
    fail(`${skill} missing .agents/skills entry`);
  }
  const stat = fs.lstatSync(agentEntry);
  if (!stat.isSymbolicLink()) {
    fail(`${skill} .agents/skills entry must be a symlink`);
  }
  const resolved = fs.realpathSync(agentEntry);
  if (resolved !== fs.realpathSync(skillDir)) {
    fail(`${skill} .agents/skills symlink target mismatch`);
  }
}

pass(`validated ${requiredSkills.length} AreaForge repo-local skills`);
