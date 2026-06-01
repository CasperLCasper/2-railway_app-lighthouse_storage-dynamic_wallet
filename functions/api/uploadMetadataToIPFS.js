import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. Autentifikācija
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user || !user.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Rate limits
    const rateKey = `upload-metadata:${user.address}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. JSON nolasīšana
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
      console.error("❌ Railway sistēmā nav atrasts LIGHTHOUSE_API_KEY!");
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`🚀 Sākam metadatu augšupielādi uz universālo Lighthouse API...`);

    // Konvertējam JSON uz Buffer un tad uz drošu drošu Blob sistēmas stabilitātei
    const jsonString = JSON.stringify(metadata);
    const nodeBuffer = Buffer.from(jsonString, 'utf-8');
    const metadataBlob = new Response(nodeBuffer).blob();
    
    const customFormData = new FormData();
    customFormData.append('file', await metadataBlob, 'metadata.json');

    // 4. Sūtām uz stabilo API galapunktu (api. node. vietā)
    const response = await fetch('https://api.lighthouse.storage/api/v0/add', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`
      },
      body: customFormData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Lighthouse API noraidīja metadatus: ${response.status} - ${errorText}`);
      throw new Error(`Lighthouse HTTP Error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const dataObj = Array.isArray(result) ? result[0] : result;

    if (!dataObj || !dataObj.Hash) {
      console.error('❌ Lighthouse neatgrieza Hash metadatiem. Atbilde:', result);
      throw new Error('No CID returned for metadata');
    }

    const cid = dataObj.Hash;
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
    console.error('💥 Metadatu augšupielādes kļūda manuālajā fetch:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
