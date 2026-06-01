import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import lighthouse from '@lighthouse-web3/sdk';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. Lietotāja autentifikācija
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user || !user.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Ātruma ierobežojums (Rate limiting) metadatiem
    const rateKey = `upload-metadata:${user.address}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. JSON datu saņemšana no klienta
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

    console.log(`🚀 Augšupielādējam NFT JSON metadatus caur Lighthouse SDK...`);

    const jsonString = JSON.stringify(metadata);

    // 4. Izmantojam oficiālo SDK funkciju tīra teksta/JSON noglabāšanai
    // parametri: lighthouse.uploadText(text, apiKey)
    const result = await lighthouse.uploadText(jsonString, env.LIGHTHOUSE_API_KEY);

    // 5. Pārbaudām un atgriežam rezultātu
    if (!result || !result.data || !result.data.Hash) {
      console.error('❌ Lighthouse SDK neatgrieza derīgu Hash metadatiem. Atbilde:', result);
      return new Response(JSON.stringify({ error: 'Upload failed - no CID returned for metadata' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cid = result.data.Hash;
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
