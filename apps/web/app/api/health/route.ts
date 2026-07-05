export async function GET() {
  return Response.json({
    ok: true,
    service: "AreaForge",
    version: process.env.APP_VERSION ?? "0.1.0",
  });
}

