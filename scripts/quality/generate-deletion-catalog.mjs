import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

// 使用 Prisma 自己解析的 DMMF，不再另写一套 schema 解析器猜测主键或外键。
const input = createInterface({ input: process.stdin, terminal: false });
for await (const line of input) {
  const request = JSON.parse(line);
  try {
    let result = null;
    if (request.method === "getManifest") result = { manifest: { prettyName: "AreaForge deletion catalog", defaultOutput: "../packages/db/generated/data-delete" } };
    else if (request.method === "generate") await generate(request.params);
    else throw new Error("Unsupported generator request");
    process.stderr.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  } catch {
    process.stderr.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "DATA_DELETE_CATALOG_GENERATION_FAILED" } }) + "\n");
  }
}

async function generate(options) {
  const output = options.generator.output?.value;
  if (!output || !Array.isArray(options.dmmf?.datamodel?.models)) throw new Error("Missing metadata");
  const models = options.dmmf.datamodel.models.map(model => ({ name: model.name, dbName: model.dbName,
    primaryKey: model.primaryKey, fields: model.fields.map(field => ({ name: field.name, kind: field.kind,
      type: field.type, isId: field.isId, isList: field.isList, isRequired: field.isRequired,
      relationFromFields: field.relationFromFields, relationToFields: field.relationToFields, relationOnDelete: field.relationOnDelete })) }));
  const catalog = { schemaHash: "sha256:" + createHash("sha256").update(options.datamodel).digest("hex"), models };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "models.json"), JSON.stringify(catalog, null, 2) + "\n");
}
