import { supabase } from "./supabase.js";

export async function uploadImage(metaUrl: string, productId: string): Promise<string | null> {
  try {
    const res = await fetch(metaUrl);
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.split("/")[1] ?? "jpg";
    const fileName = `${productId}.${ext}`;

    const { error } = await supabase.storage
      .from("product-images")
      .upload(fileName, buffer, { contentType, upsert: true });

    if (error) return null;

    return supabase.storage.from("product-images").getPublicUrl(fileName).data.publicUrl;
  } catch {
    return null;
  }
}