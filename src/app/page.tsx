import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MessageCircle, Bot, ShoppingBag, Users, TrendingUp, CheckCircle } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">WhatsApp OrderDesk</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-gray-600 md:flex">
            <a href="#features" className="hover:text-gray-900">Features</a>
            <a href="#how" className="hover:text-gray-900">How it Works</a>
            <a href="#pricing" className="hover:text-gray-900">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login"><Button variant="ghost" size="sm">Login</Button></Link>
            <Link href="/signup"><Button size="sm">Start Free</Button></Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-1.5 text-sm text-green-700">
          <Bot size={16} /> AI Agent — WhatsApp ke andar automatically kaam karta hai
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 md:text-6xl">
          Turn WhatsApp Orders Into<br />an Organized Business
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
          AI agent aap ke WhatsApp chats ke andar orders leta hai, confirm karta hai, aur dashboard pe sab organize karta hai — bina copy-paste ke.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/signup"><Button size="lg">Start Free — 14 Day Trial</Button></Link>
          <a href="#how"><Button variant="outline" size="lg">See How It Works</Button></a>
        </div>
      </section>

      <section id="how" className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">WhatsApp ke andar sab automatic</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { step: "1", title: "Customer messages on WhatsApp", desc: "Aap ka AI agent turant reply karta hai — greeting, products, order details." },
              { step: "2", title: "AI takes & confirms order", desc: "Agent conversation se order samajhta hai, confirm karwata hai, aur create karta hai." },
              { step: "3", title: "Track from dashboard", desc: "Orders, payments, delivery — sab dashboard pe. WhatsApp updates bhi auto bhejein." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="rounded-xl bg-white p-6 shadow-sm">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">{step}</div>
                <h3 className="font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">Everything you need</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Bot, title: "WhatsApp AI Agent", desc: "Automatically manages chats, takes orders, answers queries" },
              { icon: ShoppingBag, title: "Order Management", desc: "Full order lifecycle from WhatsApp to delivery" },
              { icon: Users, title: "Customer CRM", desc: "Auto-captured from WhatsApp conversations" },
              { icon: TrendingUp, title: "Sales Analytics", desc: "Real revenue, orders, and customer insights" },
              { icon: MessageCircle, title: "Auto WhatsApp Replies", desc: "Order confirmation, delivery updates, payment reminders" },
              { icon: CheckCircle, title: "Multi-language", desc: "Urdu/English mix — natural Pakistani business style" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-gray-200 p-6">
                <Icon className="h-8 w-8 text-green-600" />
                <h3 className="mt-4 font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">Simple Pricing</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { plan: "Starter", price: "$9.99", features: ["500 orders/mo", "Basic CRM", "Manual orders"] },
              { plan: "Pro", price: "$19.99", features: ["2,000 orders/mo", "WhatsApp AI Agent", "Auto order creation", "Analytics"], popular: true },
              { plan: "Business", price: "$39.99", features: ["Unlimited orders", "Priority support", "Team members", "Advanced tools"] },
            ].map(({ plan, price, features, popular }) => (
              <div key={plan} className={`rounded-xl bg-white p-6 shadow-sm ${popular ? "ring-2 ring-green-600" : "border border-gray-200"}`}>
                {popular && <span className="text-xs font-medium text-green-600">Most Popular</span>}
                <h3 className="mt-2 text-xl font-bold">{plan}</h3>
                <p className="mt-2 text-3xl font-bold">{price}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                <ul className="mt-6 space-y-2">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <CheckCircle size={14} className="text-green-600" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="mt-6 block">
                  <Button className="w-full" variant={popular ? "default" : "outline"}>Start Free Trial</Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 text-center">
        <h2 className="text-3xl font-bold text-gray-900">Start organizing your WhatsApp orders today</h2>
        <Link href="/signup" className="mt-6 inline-block">
          <Button size="lg">Start Free — No Credit Card</Button>
        </Link>
      </section>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-500">
        © 2026 WhatsApp OrderDesk. Turn WhatsApp orders into an organized business.
      </footer>
    </div>
  );
}
