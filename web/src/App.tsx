import { useEffect, useState, type FormEvent } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const WORKFLOW_TYPES = ['Accounts Payable Processor', 'Quotation Assistant', 'Customer Inquiry Bot'];

const SAMPLE_INPUT: Record<string, string> = {
  'Accounts Payable Processor': 'Invoice from Acme Supplies. Total: 12,500.00 USD',
  'Quotation Assistant': 'Please quote 10 office chairs and 5 standing desks',
  'Customer Inquiry Bot': 'Hi, my order has not arrived yet. Can you help me?',
};

type Agent = {
  id: string;
  name: string;
  workflow_type: string;
  config: Record<string, unknown>;
  created_at: string;
};

type Run = {
  id: string;
  input: string;
  status: string;
  output: string | null;
  duration_ms: number | null;
  created_at: string;
};

type OrgData = {
  organization: { name: string };
  me: { email: string; role: string };
  members: { id: string; email: string; role: string }[];
  invitations: { id: string; email: string; status: string }[];
};

// Calls our backend with the Supabase access token.
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Request failed');
  return json as T;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <p className="container">Loading...</p>;
  return session ? <Portal key={session.user.id} /> : <AuthForm />;
}

// ============ LOGIN / SIGN UP ============
function AuthForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { org_name: orgName } } });
    if (error) setError(error.message);
  }

  return (
    <div className="card narrow">
      <h1>AI Agent Portal</h1>
      <h2>{mode === 'login' ? 'Log in' : 'Sign up'}</h2>
      <form onSubmit={submit}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {mode === 'signup' && (
          <input
            placeholder="Organization name (leave empty if you were invited)"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
        )}
        <button type="submit">{mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <button className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'No account? Sign up' : 'Have an account? Log in'}
      </button>
    </div>
  );
}

// ============ MAIN PORTAL ============
function Portal() {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [orgData, agentList] = await Promise.all([api<OrgData>('/org'), api<Agent[]>('/agents')]);
      setOrg(orgData);
      setAgents(agentList);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function deleteAgent(agent: Agent) {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    await api(`/agents/${agent.id}`, 'DELETE');
    if (selected?.id === agent.id) setSelected(null);
    load();
  }

  return (
    <div className="container">
      <header>
        <h1>{org?.organization.name ?? 'AI Agent Portal'}</h1>
        <div>
          {org?.me.email} ({org?.me.role}){' '}
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {org && <OrgPanel org={org} onChange={load} />}

      <AgentForm
        key={editing?.id ?? 'new'}
        agent={editing}
        onSaved={() => {
          setEditing(null);
          load();
        }}
        onCancel={() => setEditing(null)}
      />

      <section className="card">
        <h2>Agents ({agents.length})</h2>
        {agents.length === 0 ? (
          <p>No agents yet. Create your first agent above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Workflow type</th>
                <th>Configuration</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td>{agent.name}</td>
                  <td>{agent.workflow_type}</td>
                  <td>
                    <pre>{JSON.stringify(agent.config, null, 1)}</pre>
                  </td>
                  <td>{new Date(agent.created_at).toLocaleString()}</td>
                  <td className="actions">
                    <button onClick={() => setSelected(agent)}>Runs</button>
                    <button className="secondary" onClick={() => setEditing(agent)}>
                      Edit
                    </button>
                    <button className="danger" onClick={() => deleteAgent(agent)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && <RunsPanel key={selected.id} agent={selected} />}
    </div>
  );
}

// ============ ORGANIZATION + INVITES ============
function OrgPanel({ org, onChange }: { org: OrgData; onChange: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  async function invite(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/invitations', 'POST', { email });
      setMessage(`Invitation sent to ${email} (mocked). They join by signing up with this email.`);
      setEmail('');
      onChange();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>Organization: {org.organization.name}</h2>
      <h3>Members</h3>
      <ul>
        {org.members.map((m) => (
          <li key={m.id}>
            {m.email} ({m.role})
          </li>
        ))}
      </ul>
      <h3>Invitations</h3>
      <ul>
        {org.invitations.length === 0 && <li>No invitations yet</li>}
        {org.invitations.map((i) => (
          <li key={i.id}>
            {i.email} ({i.status})
          </li>
        ))}
      </ul>
      {org.me.role === 'admin' && (
        <form onSubmit={invite} className="inline">
          <input type="email" placeholder="new.user@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit">Invite user</button>
        </form>
      )}
      {message && <p>{message}</p>}
    </section>
  );
}

// ============ CREATE / EDIT AGENT ============
function AgentForm({
  agent,
  onSaved,
  onCancel,
}: {
  agent: Agent | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(agent?.name ?? '');
  const [workflowType, setWorkflowType] = useState(agent?.workflow_type ?? 'Accounts Payable Processor');
  const [config, setConfig] = useState(
    JSON.stringify(agent?.config ?? { approvalThreshold: 10000, responseLanguage: 'en' }, null, 2),
  );
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(config);
    } catch {
      setError('Configuration must be valid JSON');
      return;
    }
    try {
      const body = { name, workflow_type: workflowType, config: parsedConfig };
      if (agent) await api(`/agents/${agent.id}`, 'PUT', body);
      else await api('/agents', 'POST', body);
      setName('');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>{agent ? `Edit agent: ${agent.name}` : 'Create agent'}</h2>
      <form onSubmit={submit}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>Workflow type</label>
        <select value={workflowType} onChange={(e) => setWorkflowType(e.target.value)}>
          {WORKFLOW_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <label>Configuration (JSON)</label>
        <textarea value={config} onChange={(e) => setConfig(e.target.value)} rows={5} />
        <button type="submit">{agent ? 'Save changes' : 'Create agent'}</button>
        {agent && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// ============ RUNS OF ONE AGENT ============
function RunsPanel({ agent }: { agent: Agent }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [input, setInput] = useState(SAMPLE_INPUT[agent.workflow_type] ?? '');
  const [error, setError] = useState('');

  // Poll every 2 seconds so the status changes appear on screen.
  useEffect(() => {
    const loadRuns = () =>
      api<Run[]>(`/agents/${agent.id}/runs`)
        .then(setRuns)
        .catch((e: Error) => setError(e.message));
    loadRuns();
    const timer = setInterval(loadRuns, 2000);
    return () => clearInterval(timer);
  }, [agent.id]);

  async function triggerRun(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const run = await api<Run>(`/agents/${agent.id}/runs`, 'POST', { input });
      setRuns((current) => [run, ...current]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>Runs: {agent.name}</h2>
      <form onSubmit={triggerRun}>
        <label>Sample input</label>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} required />
        <button type="submit">Run agent</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Input</th>
            <th>Output</th>
            <th>Duration</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <span className={`status ${run.status}`}>{run.status.replace('_', ' ')}</span>
              </td>
              <td>{run.input}</td>
              <td>{run.output ?? '...'}</td>
              <td>{run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : '-'}</td>
              <td>{new Date(run.created_at).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
