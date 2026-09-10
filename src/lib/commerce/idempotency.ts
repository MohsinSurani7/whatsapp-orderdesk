import { createHash } from "crypto";
import { cartFingerprint, type CartLine } from "@/lib/commerce/cart";

export function orderIdempotencyKey(params: {
  businessId: string;
  conversationId: string;
  lines: CartLine[];
  address?: string | null;
  payment?: string | null;
}) {
  const raw = [
    params.businessId,
    params.conversationId,
    cartFingerprint(params.lines),
    params.address || "",
    params.payment || "",
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
