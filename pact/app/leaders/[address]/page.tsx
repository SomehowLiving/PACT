import { LeaderPage } from "@/components/pages/LeaderPage";

export default async function Leader({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <LeaderPage address={address} />;
}
