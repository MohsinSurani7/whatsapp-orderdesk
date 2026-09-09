import { notFound } from "next/navigation";
import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { ConversationChat } from "./conversation-chat";

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
    .sort((a, t) => a.created_at.localeCompare(t.created_at))
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      message_type: m.message_type,
      content: m.content,
      image_url: m.image_url,
      created_at: m.created_at,
    }));

  return (
    <div className="-m-4 mb-0 sm:-m-6 lg:-m-8 lg:mb-0">
    <ConversationChat
      conversationId={conv.id}
      customerName={conv.customer_name || conv.customer_phone}
      customerPhone={conv.customer_phone}
      status={conv.status}
      agentPaused={conv.agent_paused === true}
      messages={messages}
    />
    </div>
  );
}
