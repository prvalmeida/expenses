import { NextResponse } from 'next/server';
import connectToDatabase from '../../../lib/mongodb';

// A cached/prerendered handler would keep reporting a stale 200 and leave an
// unhealthy instance in the load balancer pool; Mongoose also cannot run on Edge.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Must stay below the probe timeout (ALB defaults to 5s) so an unreachable
// cluster yields a clean 503 instead of a hung request pinning a connection.
const PING_DEADLINE_MS = 2500;

const NO_STORE = { 'Cache-Control': 'no-store' };

async function pingDatabase() {
  const conn = await connectToDatabase();
  // A truthy cached connection survives a dropped socket — only a live command
  // proves the database is usable right now.
  const admin = conn.connection.db?.admin();
  if (!admin) throw new Error('Conexão sem handle de banco ativo');
  // The deadline goes to the driver too: the outer race only stops *waiting*,
  // so without this the command keeps running for the full 30s server-selection
  // window and a sustained outage stacks one abandoned attempt per probe.
  await admin.command({ ping: 1 }, { timeoutMS: PING_DEADLINE_MS });
}

export async function GET() {
  let deadline: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      pingDatabase(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error(`Ping excedeu ${PING_DEADLINE_MS}ms`)),
          PING_DEADLINE_MS,
        );
      }),
    ]);

    return NextResponse.json(
      { status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() },
      { headers: NO_STORE },
    );
  } catch (error) {
    // The endpoint is unauthenticated and Mongo errors carry the cluster
    // hostname — log the detail, return none.
    console.error('[health] verificação do banco falhou:', error);
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: NO_STORE });
  } finally {
    clearTimeout(deadline);
  }
}
