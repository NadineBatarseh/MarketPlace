import "dotenv/config";
import supabase from "./server/supabase.js";

async function main() {
  const { data: couriers } = await supabase
    .from("couriers")
    .select("id, name, status")
    .ilike("name", "%driver1%");
  console.log("Couriers matching driver1:", JSON.stringify(couriers, null, 2));

  if (!couriers?.length) {
    const { data: all } = await supabase.from("couriers").select("id, name, status").limit(10);
    console.log("First 10 couriers:", JSON.stringify(all, null, 2));
    return;
  }

  for (const c of couriers) {
    const { data: batches } = await supabase
      .from("batches")
      .select("id, status, assigned_to, assigned_at, started_at, ab_shipment_ids, bc_shipment_ids")
      .eq("assigned_to", c.id);
    console.log(`Batches for courier ${c.id} (${c.name}, status=${c.status}):`, JSON.stringify(batches, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
