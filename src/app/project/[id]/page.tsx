import { EditorClient } from '@/client/editor/EditorClient';

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ prompt?: string; import?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  return <EditorClient projectId={id} initialPrompt={sp.prompt} openImport={sp.import === '1'} />;
}
