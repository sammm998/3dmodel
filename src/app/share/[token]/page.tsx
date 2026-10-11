import { EditorClient } from '@/client/editor/EditorClient';

export const metadata = { title: 'Shared model — AI 3D Studio' };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EditorClient shareToken={token} />;
}
