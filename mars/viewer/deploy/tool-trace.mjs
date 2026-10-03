// Optional verification tracing: never print arguments, responses or credentials.
export function traceClientTools(client, label, { enabled = false, write = console.log, now = () => performance.now() } = {}) {
  if (!enabled) return;
  const call = client.callTool.bind(client);
  let index = 0;
  client.callTool = async (...params) => {
    const name = params[0].name;
    const prefix = `MCP TRACE ${label} #${++index} ${name}`;
    const started = now();
    write(`${prefix} START`);
    try {
      const result = await call(...params);
      write(`${prefix} END ${Math.round(now() - started)}ms ${result.isError ? 'diagnostic' : 'ok'}`);
      return result;
    } catch (error) {
      write(`${prefix} TRANSPORT FAILURE ${Math.round(now() - started)}ms`);
      throw error;
    }
  };
}
