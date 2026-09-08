import { requireBusiness } from "@/lib/auth/business";
import { readDb } from "@/lib/db/store";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export default async function CustomersPage() {
  const { businessId, business } = await requireBusiness();
  const customers = (await readDb())
    .customers.filter((c) => c.business_id === businessId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <p className="text-sm text-gray-500">WhatsApp se auto-added customers</p>
      </div>
      <Card>
        <CardContent className="p-0">
          {!customers.length ? (
            <div className="py-16 text-center text-sm text-gray-500">
              Customers automatically add honge jab WhatsApp pe order aayega
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Phone / WhatsApp</th>
                  <th className="px-6 py-3 font-medium">Address</th>
                  <th className="px-6 py-3 font-medium">Orders</th>
                  <th className="px-6 py-3 font-medium">Total Spent</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">{c.name}</td>
                    <td className="px-6 py-4">{c.phone || c.whatsapp_id || "—"}</td>
                    <td className="max-w-[240px] truncate px-6 py-4 text-gray-600">{c.address || "—"}</td>
                    <td className="px-6 py-4">{c.total_orders}</td>
                    <td className="px-6 py-4">{formatCurrency(Number(c.total_spent), business.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
