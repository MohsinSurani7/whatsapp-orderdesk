import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    error === "exists"
      ? "Yeh email already registered hai. Sign in karein."
      : error === "required"
        ? "Email aur password zaroori hain."
        : error === "failed"
          ? "Signup failed. Supabase Auth/DB check karein (profiles trigger)."
          : error
            ? "Signup failed"
            : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-600">
            <MessageCircle className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Start Free</h1>
          <p className="mt-1 text-sm text-gray-500">Automate your WhatsApp orders with AI</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create Account</CardTitle>
          </CardHeader>
          <CardContent>
            <form action="/api/auth/signup" method="post" className="space-y-4">
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" name="fullName" required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required minLength={6} className="mt-1" />
              </div>
              {message && <p className="text-sm text-red-600">{message}</p>}
              <Button type="submit" className="w-full">
                Create Account
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-gray-500">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-green-600 hover:text-green-700">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
