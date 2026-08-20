import { DraftRoutePrefetch } from "@/components/draft/draft-route-prefetch";

export default async function DraftSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <DraftRoutePrefetch draftId={id} />
      {children}
    </>
  );
}
