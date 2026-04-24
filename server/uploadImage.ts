import { supabase } from "./supabase.js";

/**
 * Upload an image (base64 data URL or remote HTTPS URL) to Supabase Storage.
 * Stored at: product-images/{productId}/{index}.{ext}
 * Returns the public URL, or null on failure.
 */
export async function uploadImage(
  metaUrl: string,
  productId: string,
  index = 0
): Promise<string | null> {
  try {
    // Handle base64 data URLs (e.g. from browser FileReader)
    if (metaUrl.startsWith('data:')) {
      const [header, base64Data] = metaUrl.split(',');
      if (!base64Data) return null;
      const contentType = header.split(':')[1]?.split(';')[0] ?? 'image/jpeg';
      const ext = contentType.split('/')[1] ?? 'jpg';
      const fileName = `${productId}/${index}.${ext}`;
      const buffer = Buffer.from(base64Data, 'base64');

      const { error } = await supabase.storage
        .from('product-images')
        .upload(fileName, buffer, { contentType, upsert: true });

      if (error) {
        console.error(`[uploadImage] storage upload failed for "${fileName}":`, error.message);
        return null;
      }
      return supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
    }

    // Handle remote HTTPS URLs
    const res = await fetch(metaUrl);
    if (!res.ok) {
      console.error(`[uploadImage] fetch failed for remote URL (status ${res.status})`);
      return null;
    }

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const ext = contentType.split('/')[1] ?? 'jpg';
    const fileName = `${productId}/${index}.${ext}`;

    const { error } = await supabase.storage
      .from('product-images')
      .upload(fileName, buffer, { contentType, upsert: true });

    if (error) {
      console.error(`[uploadImage] storage upload failed for "${fileName}":`, error.message);
      return null;
    }

    return supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
  } catch (err: any) {
    console.error('[uploadImage] unexpected error:', err?.message ?? err);
    return null;
  }
}
