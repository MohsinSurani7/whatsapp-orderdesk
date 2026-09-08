import Link from "next/link";
import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { format } from "date-fns";
import { MessageCircle } from "lucide-react";

export default async function ConversationsPage() {
  const { businessId } = await requireBusiness();
  const db = await readDb();
  const conversations = db.conversations
    .filter((c) => c.business_id === businessId)
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp Conversations</h1>
        <p className="text-sm text-gray-500">Har chat save hoti hai — khol ke poori history dekho</p>
      </div>
      {!conversations.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MessageCircle className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 font-medium text-gray-700">No conversations yet</p>
            <p className="mt-1 text-sm text-gray-500">Jab customer WhatsApp pe message karega, yahan dikhega</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => {
            const messages = db.messages.filter((m) => m.conversation_id === conv.id);
            const lastMsg = messages[messages.length - 1];
            return (
              <Link key={conv.id} href={`/whatsapp/conversations/${conv.id}`} className="block">
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                      <MessageCircle size={18} className="text-green-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-gray-900">{conv.customer_name || conv.customer_phone}</p>
                        <StatusBadge status={conv.status} />
                      </div>
                      <p className="truncate text-sm text-gray-500">
                        {lastMsg ? `${lastMsg.direction === "outbound" ? "Agent: " : ""}${lastMsg.content}` : "No messages"}
                      </p>
                    </div>
                    <p className="hidden shrink-0 text-xs text-gray-400 sm:block">
                      {format(new Date(conv.last_message_at), "MMM d, h:mm a")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
