"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check, Clock } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { ChatToolbar, DeleteMessageButton } from "./chat-toolbar";
import { ReplyForm, type PendingSend } from "./reply-form";

export type ChatMsg = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string;
  image_url: string | null;
  created_at: string;
};

export function ConversationChat(props: {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  status: string;
  agentPaused: boolean;
  messages: ChatMsg[];
}) {
  const [pending, setPending] = useState<PendingSend[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useMemo(() => [...props.messages], [props.messages]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, pending.length]);

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-3.5rem-4.5rem)] max-w-3xl flex-col sm:h-[calc(100dvh-4rem-4.5rem)] lg:h-[calc(100dvh-4rem)]">
      <header className="sticky top-0 z-10 shrink-0 border-b border-green-100 bg-white/95 px-2 py-2 backdrop-blur sm:px-3">
        <Link href="/whatsapp/conversations" className="mb-1 inline-block text-[11px] text-green-700 hover:underline sm:text-xs">
          ← All chats
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="truncate text-sm font-semibold text-gray-900 sm:text-base">
                {props.customerName}
              </h1>
              <StatusBadge status={props.status} />
              {props.agentPaused && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  Auto-reply off
                </span>
              )}
            </div>
            <p className="truncate text-[10px] text-gray-500 sm:text-xs">
              {props.customerPhone}
              {props.agentPaused
                ? " — AI off; aap khud reply karein"
                : " — AI auto-reply on (sirf ye chat)"}
            </p>
          </div>
          <ChatToolbar conversationId={props.conversationId} agentPaused={props.agentPaused} />
        </div>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-2 py-3 sm:px-4">
        {!items.length && !pending.length && (
          <p className="text-center text-xs text-gray-500">No messages saved yet</p>
        )}
        {items.map((m) => (
          <Bubble key={m.id} msg={m} conversationId={props.conversationId} />
        ))}
        {pending.map((p) => (
          <div
            key={p.id}
            className="ml-auto max-w-[85%] rounded-2xl bg-green-600 px-2.5 py-1.5 text-[12px] text-white sm:text-[13px]"
          >
            {p.kind === "image" && p.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.previewUrl} alt="" className="mb-1.5 max-h-40 w-full rounded-lg object-cover opacity-80" />
            )}
            {p.kind === "video" && p.previewUrl && (
              <video src={p.previewUrl} className="mb-1.5 max-h-40 w-full rounded-lg opacity-80" />
            )}
            {p.kind === "audio" && <p className="mb-1 opacity-90">🎤 Voice note</p>}
            {p.text && <p className="whitespace-pre-wrap">{p.text}</p>}
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-green-100">
              {p.status === "sending" ? (
                <>
                  <Clock size={11} /> sending…
                </>
              ) : (
                <span className="text-red-100">Failed — {p.error}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <ReplyForm
        conversationId={props.conversationId}
        onPending={setPending}
      />
    </div>
  );
}

function Bubble({ msg, conversationId }: { msg: ChatMsg; conversationId: string }) {
  const out = msg.direction === "outbound";
  const hideCaption =
    Boolean(msg.image_url) &&
    /^(📷 Photo|🎬 Video|🎤 Voice note|\[photo\]|\[video\])$/i.test(msg.content.trim());
  return (
    <div
      className={`max-w-[85%] rounded-2xl px-2.5 py-1.5 text-[12px] leading-snug sm:text-[13px] ${
        out ? "ml-auto bg-green-600 text-white" : "bg-white text-gray-900"
      }`}
    >
      {msg.message_type === "image" && msg.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={msg.image_url} alt="" className="mb-1.5 max-h-52 w-full rounded-lg object-cover" />
      )}
      {msg.message_type === "video" && msg.image_url && (
        <video src={msg.image_url} controls className="mb-1.5 max-h-52 w-full rounded-lg" />
      )}
      {msg.message_type === "audio" && msg.image_url && (
        <div className="mb-1.5">
          <p className="mb-1 text-[10px] opacity-80">🎤 Voice note</p>
          <audio src={msg.image_url} controls className="w-full" />
        </div>
      )}
      {msg.image_url &&
        msg.message_type !== "image" &&
        msg.message_type !== "video" &&
        msg.message_type !== "audio" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={msg.image_url} alt="" className="mb-1.5 max-h-40 rounded-lg" />
        )}
      {msg.content && !hideCaption && <p className="whitespace-pre-wrap">{msg.content}</p>}
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={`text-[9px] sm:text-[10px] ${out ? "text-green-100" : "text-gray-400"}`}>
          {format(new Date(msg.created_at), "h:mm a")}
        </p>
        <span className="flex items-center gap-2">
          {out && <Check size={12} className={out ? "text-green-100" : ""} />}
          <DeleteMessageButton conversationId={conversationId} messageId={msg.id} />
        </span>
      </div>
    </div>
  );
}
