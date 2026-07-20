import { getRuntimeIdentity } from "../../../lib/system/runtime-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeIdentity = getRuntimeIdentity();
  const ok = runtimeIdentity.status === "verified";
  return Response.json({
    ok,
    service: "AreaForge",
    version: runtimeIdentity.appVersion,
    runtimeIdentity,
  }, { status: ok ? 200 : 503 });
}
