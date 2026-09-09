"use client";

function sniffKind(file: File): "image" | "video" | "audio" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/") || /\.(ogg|webm|mp3|m4a|wav)$/i.test(file.name)) return "audio";
  return "image";
}

export async function prepareOutgoingFile(
  file: File,
  asVoice = false
): Promise<{ file: File; kind: "image" | "video" | "audio"; voice: boolean }> {
  const kind = sniffKind(file);
  if (kind === "image") {
    return { file: await compressToJpeg(file), kind: "image", voice: false };
  }
  if (kind === "audio" || asVoice) {
    return { file: await encodeAudioMpeg(file), kind: "audio", voice: false };
  }
  return { file, kind: "video", voice: false };
}

async function compressToJpeg(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("jpeg encode failed"))), "image/jpeg", 0.82);
    });
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function encodeAudioMpeg(file: File): Promise<File> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  const offline = new OfflineAudioContext(1, decoded.length, decoded.sampleRate);
  const src = offline.createBufferSource();
  const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
  const mixed = mixToMono(decoded);
  mono.copyToChannel(mixed, 0);
  src.buffer = mono;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  await ctx.close();
  const mp3 = await pcmToMp3(rendered.getChannelData(0), rendered.sampleRate);
  return new File([mp3], `voice-${Date.now()}.mp3`, { type: "audio/mpeg" });
}

function mixToMono(buf: AudioBuffer) {
  const out = new Float32Array(buf.length);
  const ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / ch;
  }
  return out;
}

async function pcmToMp3(samples: Float32Array, sampleRate: number): Promise<Blob> {
  const lame = await import("lamejs");
  const Mp3Encoder = lame.Mp3Encoder;
  if (!Mp3Encoder) throw new Error("MP3 encoder missing");
  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const block = 1152;
  const parts: BlobPart[] = [];
  for (let i = 0; i < int16.length; i += block) {
    const chunk = int16.subarray(i, i + block);
    const buf = encoder.encodeBuffer(chunk);
    if (buf.length) parts.push(Uint8Array.from(buf));
  }
  const end = encoder.flush();
  if (end.length) parts.push(Uint8Array.from(end));
  return new Blob(parts, { type: "audio/mpeg" });
}
