import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    error === "invalid" ? "Email ya password ghalat hai. Pehle Sign Up karein." : error ? "Login failed" : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-600">
            <MessageCircle className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp OrderDesk</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to manage your WhatsApp business</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <form action="/api/auth/login" method="post" className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required className="mt-1" />
              </div>
              {message && <p className="text-sm text-red-600">{message}</p>}
              <Button type="submit" className="w-full">
                Sign In
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-gray-500">
              No account?{" "}
              <Link href="/signup" className="font-medium text-green-600 hover:text-green-700">
                Start free
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
