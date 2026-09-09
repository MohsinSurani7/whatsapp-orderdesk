import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { nowIso, readDb, uid, writeDb } from "@/lib/db/store";
import {
  assertSafePublicUrl,
  downloadAndStoreImage,
  extractProductsWithGroq,
  fetchPageHtml,
  IMPORT_HARD_CAP,
} from "@/lib/catalog/import-from-url";

export const maxDuration = 120;

async function businessContext() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const db = await readDb();
  const businessId = db.members.find((m) => m.user_id === userId)?.business_id;
  if (!businessId) return null;
  const config = db.whatsapp_configs.find((c) => c.business_id === businessId);
  const groq = (config?.groq_api_key || process.env.GROQ_API_KEY || "").trim();
  return { db, businessId, groq };
}

export async function POST(request: NextRequest) {
  const ctx = await businessContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.groq || ctx.groq.length < 20) {
    return NextResponse.json(
      { error: "Pehle WhatsApp settings mein Groq API key save karein — yahi key products import ke liye use hoti hai." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  if (!url) return NextResponse.json({ error: "Website URL required" }, { status: 400 });

  try {
    assertSafePublicUrl(url);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 400 });
  }

  try {
    const page = await fetchPageHtml(url);
    const drafts = await extractProductsWithGroq({
      groqApiKey: ctx.groq,
      pageUrl: page.finalUrl,
      html: page.html,
      maxProducts: IMPORT_HARD_CAP,
    });

    if (!drafts.length) {
      return NextResponse.json(
        {
          error:
            "Is page se clear products nahi mile. Seedha products/shop page ka link try karein (homepage kabhi kabhi kam detail deti hai).",
        },
        { status: 422 }
      );
    }

    const db = await readDb();
    const existingNames = new Set(
      db.products
        .filter((p) => p.business_id === ctx.businessId)
        .map((p) => p.name.toLowerCase())
    );

    let added = 0;
    let skipped = 0;
    const created: Array<{ id: string; name: string; price: number; image_url: string | null }> = [];

    for (const d of drafts) {
      if (existingNames.has(d.name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      let image_url: string | null = null;
      if (d.source_image) {
        try {
          image_url = await downloadAndStoreImage(d.source_image, page.finalUrl);
        } catch (err) {
          console.error("Import image failed:", d.source_image, err);
        }
      }
      // Blank photo is OK — wrong photo is not. Edit se baad mein add ho sakti hai.
      const id = uid();
      db.products.push({
        id,
        business_id: ctx.businessId,
        name: d.name,
        sku: null,
        description: d.description,
        price: d.price,
        cost: null,
        stock: null,
        image_url,
        category: d.category,
        sizes: d.sizes,
        is_active: true,
        created_at: nowIso(),
      });
      existingNames.add(d.name.toLowerCase());
      created.push({ id, name: d.name, price: d.price, image_url });
      added += 1;
    }

    await writeDb(db);
    const hitCap = drafts.length >= IMPORT_HARD_CAP;
    const missingPhotos = created.filter((p) => !p.image_url).length;
    return NextResponse.json({
      ok: true,
      added,
      skipped,
      found: drafts.length,
      missing_photos: missingPhotos,
      products: created,
      note:
        added === 0
          ? "Products pehle se dashboard mein maujood the (same names skip)."
          : hitCap
            ? `Is page se ${drafts.length} products mile (safety cap ${IMPORT_HARD_CAP}). Agar website pe aur hain to dusri category/page ka link bhi import karo.`
            : `Import complete. Name/price/photo same product se match karke rakhe — unsure photos blank chhor di${
                missingPhotos ? ` (${missingPhotos} bina photo)` : ""
              }. Edit se easily theek kar sakte ho.`,
    });
  } catch (err) {
    console.error("Product import failed:", err);
    return NextResponse.json(
      { error: String((err as Error).message || err).slice(0, 300) },
      { status: 500 }
    );
  }
}
