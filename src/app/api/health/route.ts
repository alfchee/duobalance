export const dynamic = "force-static";

export function GET() {
  return Response.json({
    status: "ok",
    buildTarget: process.env.BUILD_TARGET ?? "web",
    time: new Date().toISOString(),
  });
}
