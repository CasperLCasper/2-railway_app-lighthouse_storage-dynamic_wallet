import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import lighthouse from '@lighthouse-web3/sdk';

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

    // 5. Faila pārvēršana par Buffer Node.js videi
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`🚀 Sākam augšupielādi uz Lighthouse. Fails: ${fileEntry.name}, Izmērs: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // 6. Lighthouse augšupielāde (Tikai ar buffer un apiKey parametriem)
    const result = await lighthouse.uploadBuffer(buffer, env.LIGHTHOUSE_API_KEY);

    // 7. Atbildes pārbaude
    if (!result || !result.data || !result.data.Hash) {
      console.error('❌ Lighthouse neatgrieza korektu CID. Saņemtā atbilde:', result);
      return new Response(JSON.stringify({ error: 'Upload failed - no CID returned from Lighthouse' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cid = result.data.Hash;
    console.log(`✅ Lietotājs ${user.address} veiksmīgi augšupielādēja failu caur Lighthouse: ${fileEntry.name}, CID: ${cid}`);

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
    
    // Ja Lighthouse atgriež papildu ziņojumu, izvelkam to, ja nē – parasto error.message
    const errorMessage = error.response && error.response.data 
      ? JSON.stringify(error.response.data) 
      : error.message;

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
