import { requireBusiness } from "@/lib/auth/business";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { format } from "date-fns";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

export default async function ConversationsPage() {
  const { businessId } = await requireBusiness();
  const supabase = await createClient();

  const { data: conversations } = await supabase
    .from("whatsapp_conversations")
    .select("*, whatsapp_messages(content, direction, created_at)")
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp Conversations</h1>
        <p className="text-sm text-gray-500">Live chats managed by AI agent</p>
      </div>

      {!conversations?.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MessageCircle className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 font-medium text-gray-700">No conversations yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Jab customers WhatsApp pe message karenge, conversations yahan dikhengi
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => {
            const messages = conv.whatsapp_messages as Array<{ content: string; direction: string; created_at: string }> | null;
            const lastMsg = messages?.[messages.length - 1];

            return (
              <Link key={conv.id} href={`/whatsapp/conversations/${conv.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                      <MessageCircle size={18} className="text-green-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">
                          {conv.customer_name || conv.customer_phone}
                        </p>
                        <StatusBadge status={conv.status} />
                      </div>
                      <p className="truncate text-sm text-gray-500">
                        {lastMsg ? `${lastMsg.direction === "outbound" ? "You: " : ""}${lastMsg.content}` : "No messages"}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-gray-400">
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
