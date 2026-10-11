import { aiStatus } from '@/server/ai/providers';
import { json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json(aiStatus());
}
