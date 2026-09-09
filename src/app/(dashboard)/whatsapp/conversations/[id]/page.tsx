import { notFound } from "next/navigation";
import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ReplyForm } from "./reply-form";
import { ChatToolbar, DeleteMessageButton } from "./chat-toolbar";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { businessId } = await requireBusiness();
  const db = await readDb();
  const conv = db.conversations.find((c) => c.id === id && c.business_id === businessId);
  if (!conv) notFound();
  const messages = db.messages
    .filter((m) => m.conversation_id === conv.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-28 lg:pb-0">
      <Link href="/whatsapp/conversations" className="text-sm text-green-600 hover:underline">
        ← All chats
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">{conv.customer_name || conv.customer_phone}</h1>
          <StatusBadge status={conv.status} />
          {conv.agent_paused && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Auto-reply off
            </span>
          )}
        </div>
        <ChatToolbar conversationId={conv.id} agentPaused={conv.agent_paused === true} />
      </div>
      <p className="text-sm text-gray-500">
        {conv.customer_phone}
        {conv.agent_paused
          ? " — is chat pe AI jawab nahi degi; aap khud Send se reply karein."
          : " — AI auto-reply on hai. Off karke aap manually jawab de sakte ho (sirf ye chat)."}
      </p>
      <Card className="overflow-hidden bg-[#efeae2]">
        <CardContent className="space-y-3 p-4">
          {!messages.length && <p className="text-sm text-gray-500">No messages saved yet</p>}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                m.direction === "outbound"
                  ? "ml-auto bg-green-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.message_type === "image" && m.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image_url} alt="" className="mb-2 max-h-56 w-full rounded-lg object-cover" />
              )}
              {m.message_type === "video" && m.image_url && (
                <video src={m.image_url} controls className="mb-2 max-h-56 w-full rounded-lg" />
              )}
              {m.message_type === "audio" && m.image_url && (
                <div className="mb-2">
                  <p className="mb-1 text-xs opacity-80">🎤 Voice note</p>
                  <audio src={m.image_url} controls className="w-full" />
                </div>
              )}
              {m.image_url && m.message_type !== "image" && m.message_type !== "video" && m.message_type !== "audio" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image_url} alt="" className="mb-2 max-h-48 rounded-lg" />
              )}
              {m.content &&
                !(
                  m.image_url &&
                  /^(📷 Photo|🎬 Video|🎤 Voice note|\[photo\]|\[video\])$/i.test(m.content.trim())
                ) && <p className="whitespace-pre-wrap">{m.content}</p>}
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className={`text-[10px] ${m.direction === "outbound" ? "text-green-100" : "text-gray-400"}`}>
                  {format(new Date(m.created_at), "MMM d, h:mm a")}
                </p>
                <DeleteMessageButton conversationId={conv.id} messageId={m.id} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <ReplyForm conversationId={conv.id} />
    </div>
  );
}
