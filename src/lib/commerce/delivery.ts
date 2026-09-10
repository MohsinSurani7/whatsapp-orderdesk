/** XStream-Store-Pk: free delivery Pakistan unless notes override with a number. */
export function calculateDeliveryFee(params: {
  businessName?: string;
  shopNotes?: string | null;
  address?: string | null;
}) {
  const notes = `${params.shopNotes || ""} ${params.businessName || ""}`;
  if (/free delivery|delivery free|pory pakistan|pura pakistan/i.test(notes)) return 0;
  const priced = notes.match(/delivery[^\d]{0,20}(\d{2,5})/i);
  if (priced) return parseInt(priced[1], 10);
  return 0;
}
