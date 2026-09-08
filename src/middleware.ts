import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { publicUrl } from "@/lib/http/origin";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const userId = await verifySessionToken(request.cookies.get("orderdesk_session")?.value);

  const protectedPaths = [
    "/dashboard",
    "/orders",
    "/customers",
    "/products",
    "/whatsapp",
    "/settings",
    "/onboarding",
  ];
  const authPaths = ["/login", "/signup"];
  const isProtected = protectedPaths.some((p) => path.startsWith(p));
  const isAuth = authPaths.some((p) => path.startsWith(p));

  if (isProtected && !userId) {
    return NextResponse.redirect(publicUrl(request, "/login"));
  }

  if (isAuth && userId) {
    return NextResponse.redirect(publicUrl(request, "/dashboard"));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
