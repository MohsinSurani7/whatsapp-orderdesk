import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  default: "bg-gray-100 text-gray-800",
  success: "bg-green-100 text-green-800",
  warning: "bg-yellow-100 text-yellow-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
};

export function Badge({
  className,
  variant = "default",
  children,
}: {
  className?: string;
  variant?: keyof typeof variants;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: keyof typeof variants }> = {
    pending: { label: "Pending", variant: "warning" },
    confirmed: { label: "Confirmed", variant: "info" },
    preparing: { label: "Preparing", variant: "info" },
    ready: { label: "Ready", variant: "success" },
    out_for_delivery: { label: "Out for Delivery", variant: "info" },
    delivered: { label: "Delivered", variant: "success" },
    cancelled: { label: "Cancelled", variant: "danger" },
    unpaid: { label: "Unpaid", variant: "warning" },
    paid: { label: "Paid", variant: "success" },
    active: { label: "Active", variant: "success" },
    awaiting_confirmation: { label: "Awaiting Confirm", variant: "warning" },
    handed_off: { label: "Handed Off", variant: "danger" },
  };
  const s = map[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
