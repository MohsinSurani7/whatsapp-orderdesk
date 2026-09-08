import type { NextRequest } from "next/server";

export function publicOrigin(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = request.headers.get("host")?.split(",")[0]?.trim();
  const host = forwardedHost || hostHeader || "";
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = !host || /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);

  if (host && !isLocal) {
    const scheme =
      proto ||
      (host.includes("trycloudflare.com") || host.includes("ngrok") || host.includes("loca.lt")
        ? "https"
        : "http");
    return `${scheme}://${host}`;
  }

  if (appUrl) return appUrl;
  return request.nextUrl.origin;
}

export function publicUrl(request: NextRequest, path: string) {
  return new URL(path, `${publicOrigin(request)}/`);
}
