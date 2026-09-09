export async function transcribeWhatsAppAudio(params: {
  groqApiKey?: string | null;
  bytes: Buffer;
  mimeType?: string;
}): Promise<string | null> {
  const key = (params.groqApiKey || process.env.GROQ_API_KEY || "").trim();
  if (!key || key.length < 20) return null;

  const mime = params.mimeType || "audio/ogg";
  const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("wav") ? "wav" : "ogg";
  const blob = new Blob([new Uint8Array(params.bytes)], { type: mime });
  const form = new FormData();
  form.append("file", blob, `voice.${ext}`);
  form.append("model", "whisper-large-v3");
  form.append("temperature", "0");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq whisper failed: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  const text = (data.text || "").trim();
  return text || null;
}
