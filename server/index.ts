import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PORT = Number(process.env.PORT ?? 4000);

// Service role client: bypasses RLS. Used only to verify tokens and by the background worker.
const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Client that acts as the logged in user: every query goes through RLS.
function userDb(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const WORKFLOW_TYPES = ['Accounts Payable Processor', 'Quotation Assistant', 'Customer Inquiry Bot'];

const app = express();
app.use(cors());
app.use(express.json());

// ============ AUTHENTICATION MIDDLEWARE ============
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  const { data, error } = await adminDb.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  const db = userDb(token);
  const { data: profile } = await db
    .from('profiles')
    .select('org_id, role, email')
    .eq('id', data.user.id)
    .single();
  if (!profile) {
    res.status(403).json({ error: 'User has no organization' });
    return;
  }
  res.locals.db = db;
  res.locals.userId = data.user.id;
  res.locals.orgId = profile.org_id;
  res.locals.role = profile.role;
  res.locals.email = profile.email;
  next();
}

app.use('/api', requireAuth);

const db = (res: Response) => res.locals.db as SupabaseClient;

// ============ ORGANIZATION ============
app.get('/api/org', async (_req, res) => {
  const [org, members, invitations] = await Promise.all([
    db(res).from('organizations').select('*').eq('id', res.locals.orgId).single(),
    db(res).from('profiles').select('id, email, role, created_at').order('created_at'),
    db(res).from('invitations').select('*').order('created_at', { ascending: false }),
  ]);
  res.json({
    organization: org.data,
    me: { email: res.locals.email, role: res.locals.role },
    members: members.data ?? [],
    invitations: invitations.data ?? [],
  });
});

// Mocked invite: we only save the invitation. The person joins when they sign up with that email.
app.post('/api/invitations', async (req, res) => {
  if (res.locals.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can invite users' });
    return;
  }
  const email = String(req.body.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    res.status(400).json({ error: 'Valid email is required' });
    return;
  }
  const { data, error } = await db(res)
    .from('invitations')
    .insert({ org_id: res.locals.orgId, email })
    .select()
    .single();
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.log(`[MOCK EMAIL] Invitation sent to ${email}`);
  res.status(201).json(data);
});

// ============ AGENTS ============
function validateAgent(body: Record<string, unknown>): string | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return 'Name is required';
  if (!WORKFLOW_TYPES.includes(String(body.workflow_type))) return 'Invalid workflow type';
  const config = body.config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return 'Config must be a JSON object';
  }
  return null;
}

app.get('/api/agents', async (_req, res) => {
  const { data, error } = await db(res)
    .from('agents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.json(data);
});

app.post('/api/agents', async (req, res) => {
  const invalid = validateAgent(req.body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const { name, workflow_type, config } = req.body;
  const { data, error } = await db(res)
    .from('agents')
    .insert({ org_id: res.locals.orgId, name: name.trim(), workflow_type, config })
    .select()
    .single();
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

app.put('/api/agents/:id', async (req, res) => {
  const invalid = validateAgent(req.body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const { name, workflow_type, config } = req.body;
  const { data, error } = await db(res)
    .from('agents')
    .update({ name: name.trim(), workflow_type, config })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json(data);
});

app.delete('/api/agents/:id', async (req, res) => {
  const { data, error } = await db(res)
    .from('agents')
    .delete()
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.status(204).end();
});

// ============ AGENT RUNS ============
app.get('/api/agents/:id/runs', async (req, res) => {
  const { data, error } = await db(res)
    .from('agent_runs')
    .select('*')
    .eq('agent_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.json(data);
});

app.post('/api/agents/:id/runs', async (req, res) => {
  const input = String(req.body.input ?? '').trim();
  if (!input) {
    res.status(400).json({ error: 'Input is required' });
    return;
  }
  // RLS: an agent from another organization is not visible, so this returns 404.
  const { data: agent } = await db(res)
    .from('agents')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  const { data: run, error } = await db(res)
    .from('agent_runs')
    .insert({ org_id: res.locals.orgId, agent_id: agent.id, input })
    .select()
    .single();
  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  // Asynchronous processing: respond now, process in the background.
  void processRun(run.id, agent.workflow_type, agent.config, input);
  res.status(202).json(run);
});

// ============ BACKGROUND WORKER (simulation) ============
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function processRun(
  runId: string,
  workflowType: string,
  config: Record<string, unknown>,
  input: string,
) {
  try {
    await sleep(1500); // stays "pending" in the queue for a moment
    const startedAt = Date.now();
    await adminDb
      .from('agent_runs')
      .update({ status: 'in_progress', started_at: new Date(startedAt).toISOString() })
      .eq('id', runId);

    await sleep(2000 + Math.random() * 3000); // simulated work

    await adminDb
      .from('agent_runs')
      .update({
        status: 'completed',
        output: mockOutput(workflowType, config, input),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      })
      .eq('id', runId);
    console.log(`[WORKER] run ${runId} completed`);
  } catch (err) {
    console.error(`[WORKER] run ${runId} failed`, err);
  }
}

function mockOutput(workflowType: string, config: Record<string, unknown>, input: string): string {
  if (workflowType === 'Accounts Payable Processor') {
    const numbers = (input.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, '')));
    const amount = numbers.length ? Math.max(...numbers) : 0;
    const threshold = Number(config.approvalThreshold ?? 10000);
    return amount > threshold
      ? `Invoice flagged for manager approval: amount ${amount} is above the threshold of ${threshold}`
      : `Invoice approved: amount ${amount} is within the threshold of ${threshold}`;
  }
  if (workflowType === 'Quotation Assistant') {
    return `Quotation generated: Q-${Math.floor(1000 + Math.random() * 9000)}, valid for 30 days`;
  }
  return config.responseLanguage === 'es'
    ? 'Respuesta redactada: Gracias por contactarnos. Estamos revisando tu caso y te responderemos pronto.'
    : 'Reply drafted: Thank you for contacting us. We are reviewing your case and will reply soon.';
}

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
