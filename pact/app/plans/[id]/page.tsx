import { PlanPage } from "@/components/pages/PlanPage";

export default async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanPage id={id} />;
}
