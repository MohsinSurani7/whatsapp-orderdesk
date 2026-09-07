# WhatsApp OrderDesk

**Turn WhatsApp orders into an organized business.**

AI-powered WhatsApp automation SaaS for small businesses. An AI agent works **inside WhatsApp chats** to automatically take orders, confirm details, reply to customers, and sync everything to your dashboard.

## Core Concept

This is **WhatsApp automation** — not just a dashboard with copy-paste:

1. Customer sends a WhatsApp message
2. Meta webhook triggers our AI agent
3. Agent understands intent (order, status, inquiry)
4. Agent replies automatically in WhatsApp
5. Confirmed orders auto-create in dashboard
6. You send delivery/payment updates back via WhatsApp

## Stack

- **Frontend:** Next.js 16 + TypeScript + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **AI:** OpenAI (provider abstraction, fallback parser included)
- **WhatsApp:** Meta Cloud API (webhook + send messages)
- **Deploy:** Vercel-compatible

## Quick Start

```bash
cd whatsapp-orderdesk
npm install
cp .env.example .env.local
# Fill in Supabase + AI + WhatsApp credentials
npm run dev
```

## Database Setup

1. Create a Supabase project
2. Run migration: `supabase/migrations/001_initial_schema.sql`
3. Add env vars to `.env.local`

## WhatsApp Setup

1. Create a Meta Developer app with WhatsApp product
2. Get Phone Number ID, WABA ID, and permanent access token
3. Set webhook URL: `https://your-domain.com/api/webhooks/whatsapp`
4. Use verify token from `.env.local` (`WHATSAPP_VERIFY_TOKEN`)
5. Enter credentials in Dashboard → WhatsApp Agent

## Project Structure

```
src/
├── app/
│   ├── (auth)/          # Login, signup
│   ├── (dashboard)/     # Protected app pages
│   ├── api/
│   │   ├── webhooks/whatsapp/  # Meta webhook (core)
│   │   ├── whatsapp/send/      # Send template messages
│   │   └── ai/parse-order/     # Manual AI parser
│   └── onboarding/
├── lib/
│   ├── ai/agent.ts      # AI agent engine
│   ├── whatsapp/        # WhatsApp API client + webhook handler
│   └── supabase/        # DB clients
└── components/
```

## Features

- WhatsApp AI Agent (auto-reply, order taking, confirmation)
- Order / Customer / Product management
- WhatsApp conversation viewer
- Message templates (confirmation, delivery, payment)
- Multi-tenant with RLS
- Landing page + auth + onboarding
- Subscription architecture

## Environment Variables

See `.env.example` for all required variables.

## License

Private — commercial SaaS product.
