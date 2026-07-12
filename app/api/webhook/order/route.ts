import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const order_no = body.order_no ?? body.orderNo;
    if (!order_no) return NextResponse.json({ error: "Missing order_no" }, { status: 400 });

    const { data: existing } = await supabase
      .from("install_jobs")
      .select("id")
      .eq("order_no", order_no)
      .single();

    const payload = {
      order_no,
      bill_no: body.bill_no ?? body.billNo,
      sku: body.sku,
      product_name: body.product_name ?? body.productName,
      customer_name: body.customer_name ?? body.customerName,
      phone: body.phone,
      address: body.address,
      order_date: body.order_date ?? body.orderDate ?? new Date().toISOString().slice(0, 10),
      order_source: body.order_source ?? body.orderSource ?? "web",
      stage: 1,
      status: "Active",
    };

    if (existing) {
      await supabase.from("install_jobs").update(payload).eq("id", existing.id);
      return NextResponse.json({ merged: true, id: existing.id });
    } else {
      const { data } = await supabase.from("install_jobs").insert(payload).select("id").single();
      return NextResponse.json({ created: true, id: data?.id });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
