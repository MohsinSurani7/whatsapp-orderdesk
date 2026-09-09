"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ImageIcon, Mic, Paperclip, Send, Square, Video } from "lucide-react";
import { prepareOutgoingFile } from "@/lib/media/browser-prepare";

export type PendingSend = {
  id: string;
  kind: "text" | "image" | "video" | "audio";
  text: string;
  previewUrl?: string;
  status: "sending" | "failed";
  error?: string;
};

export function ReplyForm({
  conversationId,
  onPending,
}: {
  conversationId: string;
  onPending?: (items: PendingSend[]) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<{ file: File; kind: "image" | "video" | "audio" } | null>(null);
  const pendingRef = useRef<PendingSend[]>([]);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const clipRef = useRef<HTMLInputElement>(null);

  function setPending(next: PendingSend[]) {
    pendingRef.current = next;
    onPending?.(next);
  }

  function kindOf(file: File): "image" | "video" | "audio" {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "image";
  }

  function pickFile(file: File | undefined, kind?: "image" | "video" | "audio") {
    if (!file) return;
    setPreview({ file, kind: kind || kindOf(file) });
    setError("");
    if (photoRef.current) photoRef.current.value = "";
    if (videoRef.current) videoRef.current.value = "";
    if (clipRef.current) clipRef.current.value = "";
  }

  async function sendPayload(file?: File | null, voice?: boolean) {
    const hasText = text.trim().length > 0;
    const media = file || preview?.file || null;
    if (!hasText && !media) return;
    setLoading(true);
    setError("");
    const tempId = `tmp-${Date.now()}`;
    const kind = media ? (voice || media.type.startsWith("audio/") ? "audio" : kindOf(media)) : "text";
    const previewUrl = media && kind !== "audio" ? URL.createObjectURL(media) : undefined;
    setPending([
      ...pendingRef.current,
      { id: tempId, kind, text: text.trim(), previewUrl, status: "sending" },
    ]);
    try {
      let outgoing = media;
      let asVoice = Boolean(voice);
      if (media) {
        const prepared = await prepareOutgoingFile(media, Boolean(voice) || kind === "audio");
        outgoing = prepared.file;
        asVoice = prepared.voice;
      }
      const body = new FormData();
      if (hasText) body.append("text", text.trim());
      if (outgoing) body.append("file", outgoing);
      if (asVoice) body.append("voice", "1");
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Reply nahi gayi");
      }
      setText("");
      setPreview(null);
      setPending(pendingRef.current.filter((p) => p.id !== tempId));
      router.refresh();
    } catch (err) {
      const msg = String((err as Error).message || err);
      setError(msg);
      setPending(
        pendingRef.current.map((p) =>
          p.id === tempId ? { ...p, status: "failed", error: msg.slice(0, 120) } : p
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendPayload();
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        await sendPayload(file, true);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Mic permission chahiye — browser allow karein.");
    }
  }

  function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    mediaRef.current?.stop();
    mediaRef.current = null;
  }

  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t bg-[#efeae2] p-2">
      {error && <p className="px-1 pb-1 text-xs text-red-600">{error}</p>}
      {preview && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
          <span>
            {preview.kind === "image" ? "📷 Photo ready" : preview.kind === "video" ? "🎬 Video ready" : "🎤 Voice ready"}
          </span>
          <button type="button" className="text-red-600" onClick={() => setPreview(null)}>
            Remove
          </button>
        </div>
      )}
      {recording && (
        <p className="px-1 pb-1 text-xs font-medium text-red-600">● Recording {seconds}s — stop dabao</p>
      )}
      <div className="flex items-end gap-1">
        <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0], "image")} />
        <input ref={videoRef} type="file" accept="video/mp4,video/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0], "video")} />
        <input ref={clipRef} type="file" accept="image/*,video/mp4,audio/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
        <button type="button" title="Photo" className="rounded-full p-2 text-gray-600 hover:bg-white" onClick={() => photoRef.current?.click()}>
          <ImageIcon size={18} />
        </button>
        <button type="button" title="Video" className="rounded-full p-2 text-gray-600 hover:bg-white" onClick={() => videoRef.current?.click()}>
          <Video size={18} />
        </button>
        <button type="button" title="Attach" className="rounded-full p-2 text-gray-600 hover:bg-white" onClick={() => clipRef.current?.click()}>
          <Paperclip size={18} />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder="Message"
          className="max-h-28 min-h-[38px] flex-1 resize-none rounded-2xl border-0 bg-white px-3 py-2 text-xs outline-none sm:text-sm"
        />
        {recording ? (
          <Button type="button" variant="destructive" size="sm" className="rounded-full" onClick={stopRecording}>
            <Square size={16} />
          </Button>
        ) : text.trim() || preview ? (
          <Button type="submit" disabled={loading} className="rounded-full bg-green-600 px-3">
            <Send size={16} />
          </Button>
        ) : (
          <Button type="button" disabled={loading} className="rounded-full bg-green-600 px-3" onClick={startRecording}>
            <Mic size={16} />
          </Button>
        )}
      </div>
    </form>
  );
}
