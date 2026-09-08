const WHATSAPP_API = "https://graph.facebook.com/v21.0";

export interface SendMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  message: string;
}

export interface SendTemplateParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
}

export async function sendWhatsAppText({
  phoneNumberId,
  accessToken,
  to,
  message,
}: SendMessageParams) {
  const normalizedPhone = to.replace(/\D/g, "").replace(/^0/, "92");

  const response = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "text",
      text: { preview_url: false, body: message },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp send failed: ${error}`);
  }

  return response.json();
}

export async function sendWhatsAppImage({
  phoneNumberId,
  accessToken,
  to,
  imageUrl,
  caption,
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  imageUrl: string;
  caption?: string;
}) {
  const normalizedPhone = to.replace(/\D/g, "").replace(/^0/, "92");
  const response = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "image",
      image: { link: imageUrl, caption: caption || undefined },
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp image send failed: ${error}`);
  }
  return response.json();
}

export async function markMessageAsRead(
  phoneNumberId: string,
  accessToken: string,
  messageId: string
) {
  await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    String(vars[key] ?? `{${key}}`)
  );
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "92");
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
