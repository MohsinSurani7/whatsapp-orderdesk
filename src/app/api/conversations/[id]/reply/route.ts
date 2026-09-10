import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import { uploadChatMedia } from "@/lib/db/supabase-sync";
import { sendWhatsAppMediaByLink, sendWhatsAppMediaMessage, sendWhatsAppText, uploadWhatsAppMedia } from "@/lib/whatsapp/client";
import { explainWhatsAppGraphError, resolveWhatsAppAuth } from "@/lib/whatsapp/credentials";

export const maxDuration = 60;

function sniffMime(bytes: Buffer, fallback: string) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (bytes.length >= 3 && bytes.slice(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 12 && bytes.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.slice(8, 12).toString("ascii");
    if (/mp4|isom|iso2|avc1/.test(brand)) return "video/mp4";
    if (/M4A|mp42/.test(brand)) return "audio/mp4";
    return "video/mp4";
  }
  return fallback;
}

function kindFromMime(mime: string, voice: boolean): "image" | "video" | "audio" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") || voice) return "audio";
  return null;
}

function extFor(mime: string) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("mp4") && mime.startsWith("video")) return ".mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.startsWith("audio/")) return ".m4a";
  if (mime.startsWith("video/")) return ".mp4";
  return ".bin";
}

function graphMime(mime: string) {
  if (mime.startsWith("image/")) return mime.includes("png") ? "image/png" : "image/jpeg";
  if (mime.startsWith("video/")) return "video/mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "audio/mpeg";
  if (mime.includes("ogg")) return "audio/ogg";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "audio/mp4";
  return mime;
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
      const hinted = file.type || (voiceNote ? "audio/mpeg" : "application/octet-stream");
      const bytes = Buffer.from(await file.arrayBuffer());
      const mime = sniffMime(bytes, hinted);
      const kind = kindFromMime(mime, voiceNote);
      if (!kind) {
        return NextResponse.json({ error: "Sirf photo, video ya voice/audio allowed hai" }, { status: 400 });
      }
      if (kind === "image" && !/^image\/(jpeg|png)$/.test(mime)) {
        return NextResponse.json({ error: "Photo JPEG/PNG honi chahiye" }, { status: 400 });
      }
      if (kind === "audio" && /webm/i.test(mime)) {
        return NextResponse.json(
          { error: "Voice convert nahi hui. Dobara mic se bhejein." },
          { status: 400 }
        );
      }
      const max = kind === "image" ? 5_000_000 : 16_000_000;
      if (file.size > max) {
        return NextResponse.json(
          { error: kind === "image" ? "Photo 5MB se chhoti honi chahiye" : "File 16MB se chhoti honi chahiye" },
          { status: 400 }
        );
      }
      const graphType = graphMime(mime);
      const filename = `${uid()}${extFor(graphType)}`;
      mediaUrl = await uploadChatMedia(filename, bytes, graphType);
      const useVoice = graphType === "audio/ogg";
      let sent: { messages?: Array<{ id?: string }> } | null = null;
      if (mediaUrl.startsWith("https://")) {
        try {
          sent = await sendWhatsAppMediaByLink({
            phoneNumberId,
            accessToken,
            to: conv.customer_phone,
            kind,
            link: mediaUrl,
            caption: text || undefined,
            voiceNote: useVoice,
          });
        } catch (linkErr) {
          console.error("WhatsApp media link failed, trying upload:", linkErr);
        }
      }
      if (!sent) {
        const mediaId = await uploadWhatsAppMedia({
          phoneNumberId,
          accessToken,
          bytes,
          mimeType: graphType,
          filename,
        });
        sent = await sendWhatsAppMediaMessage({
          phoneNumberId,
          accessToken,
          to: conv.customer_phone,
          kind,
          mediaId,
          caption: text || undefined,
          voiceNote: useVoice,
        });
      }
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
        error: /audio|ogg|webm|131053/i.test(msg) && !/API access blocked|"code":200/i.test(msg)
          ? "Voice/photo WhatsApp ne reject ki. Photo JPEG bhejein; voice dubara record karein."
          : explainWhatsAppGraphError(msg).message,
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
