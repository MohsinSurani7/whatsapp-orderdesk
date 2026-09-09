export async function transcribeWhatsAppAudio(params: {
  groqApiKey?: string | null;
  bytes: Buffer;
  mimeType?: string;
}): Promise<string | null> {
  const key = (params.groqApiKey || process.env.GROQ_API_KEY || "").trim();
  if (!key || key.length < 20 || /your-|placeholder|example/i.test(key)) {
    throw new Error("Groq API key missing — voice sunne ke liye Dashboard → WhatsApp pe Groq key save karein");
  }

  const mimeRaw = (params.mimeType || "audio/ogg").split(";")[0].trim().toLowerCase();
  let ext = "ogg";
  let contentType = "audio/ogg";
  if (mimeRaw.includes("mpeg") || mimeRaw.includes("mp3")) {
    ext = "mp3";
    contentType = "audio/mpeg";
  } else if (mimeRaw.includes("wav")) {
    ext = "wav";
    contentType = "audio/wav";
  } else if (mimeRaw.includes("mp4") || mimeRaw.includes("m4a") || mimeRaw.includes("aac")) {
    ext = "m4a";
    contentType = "audio/mp4";
  } else if (mimeRaw.includes("webm")) {
    ext = "webm";
    contentType = "audio/webm";
  } else {
    // WhatsApp voice notes are almost always ogg/opus
    ext = "ogg";
    contentType = "audio/ogg";
  }

  const models = ["whisper-large-v3-turbo", "whisper-large-v3"];
  let lastError = "";

  for (const model of models) {
    const form = new FormData();
    const file = new File([new Uint8Array(params.bytes)], `voice.${ext}`, { type: contentType });
    form.append("file", file);
    form.append("model", model);
    form.append("temperature", "0");
    form.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      lastError = await res.text();
      console.error(`Groq whisper ${model} failed:`, lastError.slice(0, 400));
      continue;
    }

    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();
    if (text) return text;
  }

  throw new Error(`Groq whisper failed: ${lastError.slice(0, 300) || "empty transcript"}`);
}
