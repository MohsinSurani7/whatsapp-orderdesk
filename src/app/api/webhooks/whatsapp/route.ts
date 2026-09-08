import { NextRequest, NextResponse } from "next/server";
import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse("Forbidden", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await handleWhatsAppWebhook(body);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return NextResponse.json({ status: "ok" });
  }
}
