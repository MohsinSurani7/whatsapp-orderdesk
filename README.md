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

- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **AI:** Local rule-based agent (optional Groq/OpenAI)
- **WhatsApp:** Meta Cloud API (webhook + send messages)
- **Deploy:** Netlify + Supabase

## Quick Start

```bash
cd whatsapp-orderdesk
npm install
cp .env.example .env.local
npm run dev
```

Without real Supabase keys the app uses `data/db.json` on your PC.

## Database Setup (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. SQL Editor mein ye dono files run karo:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_netlify_fields.sql`
3. Authentication → Providers: Email on. Confirm email **off** rakho (warna signup wait karega).
4. Project Settings → API se URL, `anon` key, `service_role` key copy karo (service_role secret hai).

## Netlify deploy (stable `*.netlify.app` URL)

1. GitHub pe repo push karo, Netlify pe **Import project**.
2. Build: `npm run build`, plugin: `@netlify/plugin-nextjs` (`netlify.toml` already hai).
3. Site name set karo, e.g. `whatsapp-orderdesk` → `https://whatsapp-orderdesk.netlify.app`
4. Environment variables Netlify pe wohi `.env.example` wali values.
   `NEXT_PUBLIC_APP_URL` = `https://your-site.netlify.app`
5. Deploy. Meta webhook:

`https://your-site.netlify.app/api/webhooks/whatsapp`

Verify token = `WHATSAPP_VERIFY_TOKEN`.

Yeh URL tunnel ki tarah har restart pe change **nahi** hota.

## WhatsApp Setup

1. Meta Developer app + WhatsApp product
2. Phone Number ID, WABA ID, permanent token
3. Webhook URL upar wala Netlify URL
4. Testers add karo jab tak app unpublished ho

## Free tier: 100 WhatsApp orders / day

**Haan, comfortably chal jana chahiye.**

~100 orders/day ≈ 3,000/month. Har order kuch rows (customer, messages, order, items) — database size MB se bhi kam.

Supabase Free roughly:
- Unlimited API requests
- 500 MB database
- 1 GB file storage (product photos)
- 50,000 monthly active users (dashboard logins, WhatsApp customers Auth MAU nahi ginayenge jab tak unka signup nahi)
- 5 GB egress

Netlify Free: site + serverless. 100 orders/day webhook calls easily under monthly invocation limits.

**Dhyan:**
- Free Supabase project **7 din inactive** ho to pause ho sakta hai — daily orders se pause nahi hona chahiye.
- Bohot saari high-res photos Storage 1 GB fill kar sakti hain.
- Netlify function timeout chhota hota hai; ek message pe 10 photos bhejna kabhi kabhi cut ho sakta hai.
- Production uptime/backups ke liye baad mein Supabase Pro (~$25) better hai, lekin 100 orders/day ke volume ke liye Free **kaafi** hai.

## Local tunnel (sirf PC pe test)

`npm run tunnel` — random `trycloudflare.com` URL. Production ke liye Netlify use karo.

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
