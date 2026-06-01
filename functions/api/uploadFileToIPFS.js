import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

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

    // 2. Ātruma ierobežojums (Rate limiting)
    const rateKey = `upload-file:${user.address}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many file uploads. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Form data ielasīšana un validācija
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

    // 4. API atslēgas pārbaude drošībai
    if (!env.LIGHTHOUSE_API_KEY) {
      console.error("❌ Railway sistēmā nav atrasts LIGHTHOUSE_API_KEY mainīgais!");
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 5. Sagatavojam FormData tīram API pieprasījumam
    const arrayBuffer = await fileEntry.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: contentType });
    
    const lighthouseFormData = new FormData();
    lighthouseFormData.append('file', blob, fileEntry.name);

    console.log(`🚀 Sākam tīru fetch augšupielādi uz Lighthouse API. Fails: ${fileEntry.name}, Izmērs: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // 6. Veicam pieprasījumu uz aktīvo un stabilo Lighthouse API galapunktu
    const response = await fetch('https://api.lighthouse.storage/api/v0/add', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`
      },
      body: lighthouseFormData
    });

    // 7. Pārbaudām tīkla atbildi
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Lighthouse API noraidīja pieprasījumu: ${response.status} - ${errorText}`);
      throw new Error(`Lighthouse API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (!result || !result.Hash) {
      console.error('❌ Lighthouse API neatgrieza korektu Hash. Saņemtā atbilde:', result);
      return new Response(JSON.stringify({ error: 'Upload failed - no CID returned from Lighthouse API' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cid = result.Hash;
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
