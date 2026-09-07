# WhatsApp OrderDesk — ngrok + GitHub Setup

## ngrok (WhatsApp webhook ke liye)

Local app ko internet pe expose karne ke liye ngrok chahiye taake Meta WhatsApp webhook hit kar sake.

### Step 1: ngrok account + authtoken

1. https://dashboard.ngrok.com/signup pe account banao
2. Authtoken copy karo: https://dashboard.ngrok.com/get-started/your-authtoken
3. Terminal mein run karo:

```bash
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

### Step 2: Dev server start karo

```bash
npm run dev
```

App `http://localhost:3000` pe chalegi.

### Step 3: ngrok tunnel start karo

Nayi terminal mein:

```bash
ngrok http 3000
```

Ya Windows pe:

```bash
scripts\start-ngrok.bat
```

### Step 4: Webhook URL Meta mein set karo

ngrok output mein HTTPS URL milega, jaise:

```
https://abc123.ngrok-free.app
```

Meta Developer Console → WhatsApp → Configuration → Webhook:

| Field | Value |
|-------|-------|
| Callback URL | `https://abc123.ngrok-free.app/api/webhooks/whatsapp` |
| Verify Token | `.env.local` mein `WHATSAPP_VERIFY_TOKEN` ki value |

Dashboard → WhatsApp Agent page pe bhi ye webhook URL copy ho sakti hai.

### Step 5: `.env.local` update karo

```env
NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app
```

Har baar ngrok restart pe URL change hoti hai (free plan). Naya URL Meta webhook aur `.env.local` dono mein update karo.

---

## GitHub push

### Step 1: GitHub login

```bash
gh auth login
```

Browser se login karo (GitHub account: MohsinSurani7).

### Step 2: Repo create + push

```bash
cd whatsapp-orderdesk
gh repo create whatsapp-orderdesk --public --source=. --remote=origin --push
```

Agar repo pehle se exist karta hai:

```bash
git push -u origin master
```

### Secrets kabhi commit mat karo

`.env.local` gitignore mein hai — GitHub pe sirf `.env.example` jayega.

---

## Quick checklist

- [ ] `ngrok config add-authtoken ...`
- [ ] `npm run dev` (port 3000)
- [ ] `ngrok http 3000`
- [ ] Meta webhook URL set
- [ ] `gh auth login`
- [ ] `git push -u origin master`
