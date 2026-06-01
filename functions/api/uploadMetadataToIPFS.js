import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user || !user.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const rateKey = `upload-metadata:${user.address}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    let metadata;
    try {
      metadata = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON metadata" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!metadata || Object.keys(metadata).length === 0) {
      return new Response(JSON.stringify({ error: "Metadata object cannot be empty" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!env.LIGHTHOUSE_API_KEY) {
      console.error("❌ Railway sistēmā nav atrasts LIGHTHOUSE_API_KEY mainīgais!");
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`🚀 Sākam metadatu augšupielādi uz Lighthouse priekš lietotāja: ${user.address}`);

    // LABOTS: Teksta/JSON tiešai sūtīšanai izmantojam text-json galapunktu
    const response = await fetch('https://api.lighthouse.storage/api/v0/text-json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Lighthouse API noraidīja metadatus: ${response.status} - ${errorText}`);
      throw new Error(`Lighthouse API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // text-json galapunkts atgriež { Name: '...', Hash: 'Qm...', Size: '...' } tiešā veidā
    if (!result || !result.Hash) {
      console.error('❌ Lighthouse API neatgrieza korektu Hash metadatiem. Atbilde:', result);
      return new Response(JSON.stringify({ error: 'Upload failed - no CID returned for metadata' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cid = result.Hash;
    console.log(`✅ Metadati veiksmīgi augšupielādēti! CID: ${cid}`);

    return new Response(JSON.stringify({
      ipfs: `ipfs://${cid}`,
      http: `https://gateway.lighthouse.storage/ipfs/${cid}`,
      cid: cid
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Metadatu augšupielādes kļūda (catch bloks):', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
