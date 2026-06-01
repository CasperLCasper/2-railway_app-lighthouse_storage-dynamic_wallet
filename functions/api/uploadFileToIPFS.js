import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

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

    const rateKey = `upload-file:${user.address}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many file uploads. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid form data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const fileEntry = formData.get('file');
    if (!fileEntry || !(fileEntry instanceof File)) {
      return new Response(JSON.stringify({ error: 'No file found under key "file"' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const contentType = fileEntry.type;
    const fileSize = fileEntry.size;
    
    if (!ALLOWED_TYPES.includes(contentType)) {
      return new Response(JSON.stringify({ error: `File type not allowed: ${contentType}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (fileSize > MAX_SIZE) {
      return new Response(JSON.stringify({ error: `File too large. Max 50MB` }), {
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

    const arrayBuffer = await fileEntry.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: contentType });
    
    const lighthouseFormData = new FormData();
    lighthouseFormData.append('file', blob, fileEntry.name);

    console.log(`🚀 Sākam tīru fetch augšupielādi uz īsto Lighthouse API taku. Fails: ${fileEntry.name}`);

    // LABOTS: /api/v0/add -> /api/v0/upload
    const response = await fetch('https://api.lighthouse.storage/api/v0/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`
      },
      body: lighthouseFormData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Lighthouse API noraidīja pieprasījumu: ${response.status} - ${errorText}`);
      throw new Error(`Lighthouse API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Lighthouse /upload atgriež { Name: '...', Hash: 'Qm...', Size: '...' } vai masīvu
    // Ja atgriež masīvu (vairākiem failiem), paņemam pirmo elementu
    const dataObj = Array.isArray(result) ? result[0] : result;

    if (!dataObj || !dataObj.Hash) {
      console.error('❌ Lighthouse API neatgrieza korektu Hash. Saņemtā atbilde:', result);
      return new Response(JSON.stringify({ error: 'Upload failed - no CID returned from Lighthouse API' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cid = dataObj.Hash;
    console.log(`✅ Lietotājs ${user.address} veiksmīgi augšupielādēja failu: ${fileEntry.name}, CID: ${cid}`);

    return new Response(JSON.stringify({
      ipfs: `ipfs://${cid}`,
      http: `https://gateway.lighthouse.storage/ipfs/${cid}`,
      cid: cid
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Augšupielādes kļūda (catch bloks):', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
