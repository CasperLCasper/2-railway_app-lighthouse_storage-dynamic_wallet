import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;

    let formData = await request.formData();
    const fileEntry = formData.get('file');

    // Izmantojam tradicionālo FormData
    const customFormData = new FormData();
    customFormData.append('file', fileEntry);

    console.log(`🚀 Mēģinām Lighthouse ar pilno FormData...`);

    const response = await fetch('https://api.lighthouse.storage/api/v0/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`,
        // Svarīgi: atstājam fetch pašam iestatīt pareizo boundary, 
        // bet pārliecināmies, ka neuzliekam Content-Type: application/json
      },
      body: customFormData
    });

    const result = await response.json();
    
    // Lighthouse bieži atgriež { data: { Hash: "..." } }
    const cid = result.Hash || (result.data && result.data.Hash);

    if (!cid) {
        console.error("Lighthouse atbilde:", result);
        throw new Error("Neizdevās iegūt CID");
    }

    return new Response(JSON.stringify({ ipfs: `ipfs://${cid}`, cid }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Kļūda:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
