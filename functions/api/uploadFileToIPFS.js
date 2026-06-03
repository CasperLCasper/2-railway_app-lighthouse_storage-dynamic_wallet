import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import lighthouse from '@lighthouse-web3/sdk';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;

    const formData = await request.formData();
    const fileEntry = formData.get('file');

    if (!fileEntry) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`🚀 Augšupielādējam failu caur Lighthouse SDK (storageType: lifetime)...`);

    // Pārveidojam par Buffer (saderīgs ar Cloudflare Workers)
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Izmantojam Lighthouse SDK uploadBuffer ar storageType: "lifetime"
    const uploadResponse = await lighthouse.uploadBuffer(
      buffer,
      env.LIGHTHOUSE_API_KEY,
      {
        storageType: "lifetime"
      }
    );

    // Lighthouse SDK atgriež { data: { Hash: "...", Name: "...", Size: "..." } }
    const cid = uploadResponse?.data?.Hash || uploadResponse?.Hash;

    if (!cid) {
      console.error("Lighthouse SDK atbilde:", JSON.stringify(uploadResponse));
      throw new Error("Neizdevās iegūt CID no Lighthouse SDK");
    }

    console.log(`✅ Fails veiksmīgi augšupielādēts! CID: ${cid}`);

    return new Response(JSON.stringify({
      ipfs: `ipfs://${cid}`,
      http: `https://meaningful-macaw-y3g2r.lighthouseweb3.xyz/ipfs/${cid}`,
      cid: cid
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Lighthouse SDK kļūda:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
