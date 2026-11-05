import { FollowDesk } from "@/components/FollowDesk";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  return <FollowDesk reviewProposalId={proposalId} />;
}
