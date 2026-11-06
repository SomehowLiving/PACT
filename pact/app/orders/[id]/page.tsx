import { redirect } from "next/navigation";

/** Canonical order link: /orders/<flash order id or receipt id> opens it in Orders. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/execution?order=${encodeURIComponent(id)}`);
}
