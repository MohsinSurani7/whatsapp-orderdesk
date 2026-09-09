import { Sidebar } from "@/components/dashboard/sidebar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { LiveRefresh } from "@/components/dashboard/live-refresh";
import { DesktopNotifyGate } from "@/components/dashboard/badges";
import { requireBusiness } from "@/lib/auth/business";
import { clearSessionCookie } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { business, user } = await requireBusiness();

  async function signOut() {
    "use server";
    await clearSessionCookie();
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DesktopNotifyGate />
      <Sidebar businessName={business.name} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 sm:h-16 sm:px-6 lg:px-8">
          <div className="ml-12 flex min-w-0 items-center gap-3 lg:ml-0">
            <div className="truncate text-sm font-medium text-gray-700">{business.name}</div>
            <LiveRefresh seconds={4} />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[160px] truncate text-sm text-gray-600 sm:inline">{user.email}</span>
            <form action={signOut}>
              <button type="submit" className="text-sm text-gray-500 hover:text-gray-700">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="p-4 pb-24 sm:p-6 lg:p-8 lg:pb-8">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
