import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

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
    const rateKey = `upload-file:${user.address}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many file uploads. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Form data nolasīšana
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
      console.error("❌ Railway sistēmā nav atrasts LIGHTHOUSE_API_KEY!");
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Manuāli uzbūvējam FormData priekš Lighthouse API
    const arrayBuffer = await fileEntry.arrayBuffer();
    const fileBlob = new Blob([arrayBuffer], { type: contentType });
    
    const customFormData = new FormData();
    customFormData.append('file', fileBlob, fileEntry.name);

    console.log(`🚀 Sūtām tīru HTTP POST uz Lighthouse ražošanas serveri. Fails: ${fileEntry.name}`);

    // 5. Izpildām tiešu pieprasījumu uz īsto Lighthouse API augšupielādes galapunktu
    const response = await fetch('https://api.lighthouse.storage/api/v0/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`
        // Svarīgi: Šeit Content-Type galveni NESTĀDA MANUĀLI, pārlūks/Node to izdarīs pats ar pareizo boundary!
      },
      body: customFormData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Lighthouse API atgrieza kļūdu: ${response.status} - ${errorText}`);
      throw new Error(`Lighthouse HTTP Error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Ja Lighthouse atgriež masīvu, paņemam pirmo objektu
    const dataObj = Array.isArray(result) ? result[0] : result;

    if (!dataObj || !dataObj.Hash) {
      console.error('❌ Lighthouse neatgrieza Hash. Atbilde:', result);
      throw new Error('No CID returned from Lighthouse API');
    }

    const cid = dataObj.Hash;
    console.log(`✅ Veiksmīga augšupielāde! CID: ${cid}`);

    return new Response(JSON.stringify({
      ipfs: `ipfs://${cid}`,
      http: `https://gateway.lighthouse.storage/ipfs/${cid}`,
      cid: cid
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Augšupielādes kļūda manuālajā fetch:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
