import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { setCache } from "../_lib/cache.js";
import lighthouse from '@lighthouse-web3/sdk';

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
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing LIGHTHOUSE_API_KEY' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`🚀 Augšupielādējam metadatus caur Lighthouse SDK (storageType: LIFETIME)...`);

    const jsonString = JSON.stringify(metadata);
    const buffer = Buffer.from(jsonString, 'utf-8');

    // ✅ SVARĪGI: storageType kā 5. arguments (pēc encrypt=false, encryptionParams=null)
    const uploadResponse = await lighthouse.uploadBuffer(
      buffer,
      env.LIGHTHOUSE_API_KEY,
      false,  // encrypt
      null,   // encryptionParams
      { storageType: "lifetime" }  // <-- OPTIONS OBJEKTS AR storageType
    );

    const cid = uploadResponse?.data?.Hash || uploadResponse?.Hash;

    if (!cid) {
      console.error('❌ Lighthouse SDK neatgrieza CID metadatiem. Atbilde:', JSON.stringify(uploadResponse));
      throw new Error('No CID returned for metadata from Lighthouse SDK');
    }

    console.log(`✅ Metadati veiksmīgi augšupielādēti ar LIFETIME plānu! CID: ${cid}`);

    const lastUploadKey = `lastUploadCID:${user.address.toLowerCase()}`;
    await setCache(lastUploadKey, cid, env, 5 * 60 * 1000);

    return new Response(JSON.stringify({
      ipfs: `ipfs://${cid}`,
      http: `https://meaningful-macaw-y3g2r.lighthouseweb3.xyz/ipfs/${cid}`,
      cid: cid
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Metadatu augšupielādes kļūda:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
