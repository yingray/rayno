type Json = Record<string, any>;

// Session-protocol records like the Happy CLI mapper sends them (see src/happy/subagentEnvelopes.fixture.ts).
// Each turn has a user prompt, three plain tool calls, one Agent call with a subagent that runs Glob, and a reply.
// So each turn has five tool calls, and 200 turns have 1,000.
export const TOOL_CALLS_PER_TURN = 5;

// `detail` adds a paragraph to each reply. The reply rail marks only replies with 500 or more characters.
export function toolHeavyHistory(turns = 200, lastReply = 'From the real protocol', detail = ''): Json[] {
  let time = 1700000000000, id = 0;
  const rows: Json[] = [];
  const meta = { sentFrom: 'cli' };
  for (let turn = 1; turn <= turns; turn++) {
    const subagent = turn.toString(16).padStart(24, '0');
    const agent = (ev: Json, extra: Json = {}) => rows.push({ role: 'session',
      content: { id: `perf-${++id}`, time: ++time, role: 'agent', turn: `turn-${turn}`, ...extra, ev }, meta });
    rows.push({ role: 'session', content: { id: `perf-${++id}`, time: ++time, role: 'user', ev: { t: 'text', text: `Task ${turn}: check the build` } }, meta });
    agent({ t: 'turn-start' });
    for (const [name, args] of [
      ['Bash', { command: `npm test -- --shard ${turn}`, description: 'Run tests' }],
      ['Read', { file_path: `/real/project/src/module${turn}.ts` }],
      ['Edit', { file_path: `/real/project/src/module${turn}.ts`, old_string: 'old line', new_string: 'new line' }],
    ] as const) {
      const call = `toolu_${name.toLowerCase()}_${turn}`;
      agent({ t: 'tool-call-start', call, name, title: `${name} ${turn}`, description: `${name} ${turn}`, args });
      agent({ t: 'tool-call-end', call });
    }
    const parent = `toolu_agent_${turn}`, glob = `toolu_glob_${turn}`;
    agent({ t: 'tool-call-start', call: parent, name: 'Agent', title: `Find config ${turn}`, description: `Find config ${turn}`,
      args: { description: `Find config ${turn}`, prompt: 'Find the config file.', subagent_type: 'general-purpose', sessionSubagent: subagent } });
    agent({ t: 'start', title: `Find config ${turn}` }, { subagent });
    agent({ t: 'text', text: 'Find the config file.' }, { subagent });
    agent({ t: 'tool-call-start', call: glob, name: 'Glob', title: 'Glob call', description: 'Glob call', args: { pattern: '*.json' } }, { subagent });
    agent({ t: 'tool-call-end', call: glob }, { subagent });
    agent({ t: 'text', text: `Subagent found config${turn}.json` }, { subagent });
    agent({ t: 'stop' }, { subagent });
    agent({ t: 'tool-call-end', call: parent }, { subagent });
    const extra = detail ? `\n\n${detail}` : '';
    agent({ t: 'text', text: turn === turns ? lastReply + extra
      : `### Result ${turn}\n\nThe build **passed** with a [report](https://example.com/${turn}).\n\n| Check | Status |\n| --- | --- |\n| Tests | Ready |${extra}` });
    agent({ t: 'turn-end', status: 'completed' });
  }
  return rows;
}

// Denied requests that have no tool-call record. The client adds a synthetic message for each one.
export function deniedRequests(count = 20): Json {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`toolu_denied_${index}`, {
    tool: 'WebFetch', arguments: { url: `https://example.com/${index}` },
    createdAt: 1700000000000 + index * 100, completedAt: 1700000000000 + index * 100 + 1, status: 'denied', reason: 'Not this site',
  }]));
}
