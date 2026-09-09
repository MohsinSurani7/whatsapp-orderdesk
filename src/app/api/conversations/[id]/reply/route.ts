import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import { uploadChatMedia } from "@/lib/db/supabase-sync";
import { sendWhatsAppMediaMessage, sendWhatsAppText, uploadWhatsAppMedia } from "@/lib/whatsapp/client";
import { resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";

export const maxDuration = 60;

function kindFromMime(mime: string, voice: boolean): "image" | "video" | "audio" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") || voice) return "audio";
  return null;
}

function extFor(mime: string, voice: boolean) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm") && mime.startsWith("video")) return ".webm";
  if (mime.includes("ogg") || mime.includes("webm") || voice) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.startsWith("audio/")) return ".m4a";
  if (mime.startsWith("video/")) return ".mp4";
  return ".jpg";
}

/** Graph API: voice notes must be OGG/OPUS. Chrome often records webm+opus. */
function graphMime(mime: string, voice: boolean) {
  if (voice || mime.startsWith("audio/")) {
    if (mime.includes("ogg") || mime.includes("opus") || mime.includes("webm")) return "audio/ogg";
    if (mime.includes("mpeg") || mime.includes("mp3")) return "audio/mpeg";
    if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "audio/mp4";
    return "audio/ogg";
  }
  if (mime.startsWith("video/")) return mime.includes("mp4") ? "video/mp4" : mime;
  return mime || "image/jpeg";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  const conv = db.conversations.find((c) => c.id === id && c.business_id === businessId);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const { accessToken, phoneNumberId } = resolveWhatsAppAuth(config);
  if (!accessToken || !phoneNumberId) {
    return NextResponse.json(
      { error: "Pehle Dashboard → WhatsApp pe Access Token aur Phone Number ID save karein." },
      { status: 400 }
    );
  }

  const contentType = request.headers.get("content-type") || "";
  let text = "";
  let file: File | null = null;
  let voiceNote = false;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    text = String(form.get("text") || "").trim();
    const raw = form.get("file");
    file = raw instanceof File && raw.size > 0 ? raw : null;
    voiceNote = String(form.get("voice") || "") === "1";
  } else {
    const body = await request.json().catch(() => ({}));
    text = String(body.text || "").trim();
  }

  if (!text && !file) {
    return NextResponse.json({ error: "Text ya photo/video/voice chahiye" }, { status: 400 });
  }

  let waId: string | null = null;
  let messageType = "text";
  let mediaUrl: string | null = null;
  let content = text || "";

  try {
    if (file) {
      const mime = file.type || (voiceNote ? "audio/ogg" : "application/octet-stream");
      const kind = kindFromMime(mime, voiceNote);
      if (!kind) {
        return NextResponse.json({ error: "Sirf photo, video ya voice/audio allowed hai" }, { status: 400 });
      }
      const max = kind === "image" ? 5_000_000 : 16_000_000;
      if (file.size > max) {
        return NextResponse.json(
          { error: kind === "image" ? "Photo 5MB se chhoti honi chahiye" : "File 16MB se chhoti honi chahiye" },
          { status: 400 }
        );
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const graphType = graphMime(mime, voiceNote || kind === "audio");
      const filename = `${uid()}${extFor(graphType, voiceNote || kind === "audio")}`;
      mediaUrl = await uploadChatMedia(filename, bytes, mime);
      const mediaId = await uploadWhatsAppMedia({
        phoneNumberId,
        accessToken,
        bytes,
        mimeType: graphType,
        filename,
      });
      const sent = await sendWhatsAppMediaMessage({
        phoneNumberId,
        accessToken,
        to: conv.customer_phone,
        kind,
        mediaId,
        caption: text || undefined,
        voiceNote: voiceNote || kind === "audio",
      });
      waId = sent?.messages?.[0]?.id ?? null;
      messageType = kind;
      content = text || (kind === "audio" ? "🎤 Voice note" : kind === "video" ? "🎬 Video" : "📷 Photo");
    } else {
      const sent = await sendWhatsAppText({
        phoneNumberId,
        accessToken,
        to: conv.customer_phone,
        message: text,
      });
      waId = sent?.messages?.[0]?.id ?? null;
    }
  } catch (error) {
    const msg = String(error);
    return NextResponse.json(
      {
        error:
          msg.includes("expired") || msg.includes("190")
            ? "WhatsApp token expire hai. Dashboard → WhatsApp pe naya token save karein."
            : msg.includes("audio") || msg.includes("ogg") || msg.includes("131053")
              ? "Voice note WhatsApp ne reject ki. Photo/video bhejein, ya Firefox se record karein (OGG)."
              : msg.slice(0, 280),
      },
      { status: 502 }
    );
  }

  db.messages.push({
    id: uid(),
    business_id: conv.business_id,
    conversation_id: conv.id,
    direction: "outbound",
    message_type: messageType,
    content,
    whatsapp_message_id: waId,
    image_url: mediaUrl,
    created_at: nowIso(),
  });
  conv.last_message_at = nowIso();
  if (conv.agent_paused !== true) conv.status = "active";
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
