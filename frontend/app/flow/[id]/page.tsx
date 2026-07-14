import { FlowEditor } from "@/components/flow/flow-editor";

type FlowPageProps = {
  params: Promise<{ id: string }>;
};

export default async function FlowPage({ params }: FlowPageProps) {
  const { id } = await params;
  return <FlowEditor flowId={id} />;
}
