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
  messageId: string,
  typing = false
) {
  const response = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp mark-read failed: ${error}`);
  }
}

export async function sendWhatsAppButtons({
  phoneNumberId,
  accessToken,
  to,
  body,
  buttons,
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
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
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body.slice(0, 1024) },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
          })),
        },
      },
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp buttons failed: ${error}`);
  }
  return response.json();
}

export async function sendWhatsAppList({
  phoneNumberId,
  accessToken,
  to,
  body,
  button,
  rows,
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
  button: string;
  rows: Array<{ id: string; title: string; description?: string }>;
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
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: body.slice(0, 1024) },
        action: {
          button: button.slice(0, 20),
          sections: [
            {
              title: "Shop",
              rows: rows.slice(0, 10).map((r) => ({
                id: r.id.slice(0, 200),
                title: r.title.slice(0, 24),
                description: r.description?.slice(0, 72),
              })),
            },
          ],
        },
      },
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp list failed: ${error}`);
  }
  return response.json();
}

export async function downloadWhatsAppMedia(accessToken: string, mediaId: string) {
  const meta = await fetch(`${WHATSAPP_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meta.ok) {
    throw new Error(`WhatsApp media lookup failed: ${await meta.text()}`);
  }
  const info = (await meta.json()) as { url?: string; mime_type?: string };
  if (!info.url) throw new Error("WhatsApp media URL missing");
  const file = await fetch(info.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!file.ok) {
    throw new Error(`WhatsApp media download failed: ${await file.text()}`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return { bytes, mimeType: info.mime_type || "audio/ogg" };
}

export async function uploadWhatsAppMedia(params: {
  phoneNumberId: string;
  accessToken: string;
  bytes: Buffer;
  mimeType: string;
  filename: string;
}) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", params.mimeType);
  const blob = new Blob([new Uint8Array(params.bytes)], { type: params.mimeType });
  form.append("file", blob, params.filename);
  const res = await fetch(`${WHATSAPP_API}/${params.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`WhatsApp media upload failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("WhatsApp media id missing");
  return json.id;
}

export async function sendWhatsAppMediaByLink(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  kind: "image" | "video" | "audio";
  link: string;
  caption?: string;
  voiceNote?: boolean;
}) {
  const normalizedPhone = params.to.replace(/\D/g, "").replace(/^0/, "92");
  const mediaBody =
    params.kind === "audio"
      ? { link: params.link, ...(params.voiceNote ? { voice: true } : {}) }
      : { link: params.link, ...(params.caption ? { caption: params.caption } : {}) };
  const response = await fetch(`${WHATSAPP_API}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: params.kind,
      [params.kind]: mediaBody,
    }),
  });
  if (!response.ok) {
    throw new Error(`WhatsApp ${params.kind} link send failed: ${await response.text()}`);
  }
  return response.json();
}

export async function sendWhatsAppMediaMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  kind: "image" | "video" | "audio";
  mediaId: string;
  caption?: string;
  voiceNote?: boolean;
}) {
  const normalizedPhone = params.to.replace(/\D/g, "").replace(/^0/, "92");
  const mediaBody =
    params.kind === "audio"
      ? { id: params.mediaId, ...(params.voiceNote ? { voice: true } : {}) }
      : { id: params.mediaId, ...(params.caption ? { caption: params.caption } : {}) };
  const response = await fetch(`${WHATSAPP_API}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: params.kind,
      [params.kind]: mediaBody,
    }),
  });
  if (!response.ok) {
    throw new Error(`WhatsApp ${params.kind} send failed: ${await response.text()}`);
  }
  return response.json();
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
