import { definitions } from '../../simulation/commands';
export default function Guide() {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: '60px auto',
        padding: 24,
        fontFamily: 'system-ui',
        lineHeight: 1.65,
        color: '#e1e5e7',
        height: 'auto',
        display: 'block',
        overflow: 'visible',
      }}
    >
      <a href="/studio">← Campus studio</a>
      <h1>Mars simulation control</h1>
      <p>
        Create a room in <b>Studio → Simulation & MCP</b>, then copy the MCP
        connection into a client that supports remote Streamable HTTP servers
        and Authorization headers. The endpoint is <code>/mcp?year=YYYY</code> (2020–2026) on this
        site. Each room has its own persistent state. Your browser remembers the
        room’s control key locally.
      </p>
      <p>
        Share the <b>viewing link</b> with spectators. Share the MCP
        configuration only with people or agents you want to control the room.
        No external account is needed. To start fresh with a new key, leave the
        room and create another.
      </p>
      <h2>External-agent manual</h2>
      <p>
        <a href="/simulation-agent-guide.md">
          Read or download the full connection and control guide →
        </a>
        . Give your agent this guide plus the private connection configuration
        from your room. It includes every argument, examples, clock semantics,
        error handling, and limitations.
      </p>
      <p>
        Try: “Make it rainy, orbit Chiba in slow spirals, recall all EUCs, and
        turn on the gallery.” Use <code>apply_scene</code> for one coordinated
        update. The server now supports weather, adjustable simulation speed,
        looping or one-shot camera paths, groups, rider return/dismount, and
        seven gallery displays.
      </p>
      <h2>Control tools</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['get_state', 'Current state and evaluated positions'],
            [
              'get_capabilities',
              'Complete schemas, IDs, landmarks and limitations',
            ],
            ...Object.entries(definitions).map(([name, def]) => [
              name,
              def.description,
            ]),
          ].map(([name, text]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Try directing Mars</h2>
      <p>
        “Inspect the Mars simulation. Have three outdoor people gather near the
        campfire, switch to sunset, turn on the fire, and place the camera
        nearby looking toward the group.”
      </p>
      <p>
        “Set two electric unicycle riders to 3 metres per second. Pause the
        simulation, then frame a person and make them wave.”
      </p>
      <p>
        Viewers must enable <b>Follow remote camera</b> to adopt camera
        commands. Walking/orbit controls remain available. Shared state arrives
        about once a second; movement is interpolated smoothly from the server
        clock. Simulation clocks and routes persist even when a viewer
        disconnects.
      </p>
      <h2>Coordinates and scope</h2>
      <p>
        Metres, Y up, ground Y = −0.16. Each year has independent rooms. The remote room uses the baseline selected-year
        replica. Local layout changes are separate; save and reset them before
        creating a room. Outdoor walking routes cover the central 120 × 120 m
        area. Indoor people can idle, wave and talk; stair and interior routing
        still need mapping. EUCs follow a separate loop around the full campus
        footprint. These are illustrative activities, not a record of specific
        people or events.
      </p>
      <h2>Reusable EUC model</h2>
      <p>
        <a href="/modular/environment/electric-unicycle.glb" download>
          Download the electric unicycle GLB
        </a>
        . Adapted from{' '}
        <a href="https://www.thingiverse.com/thing:3001166">
          Electric Unicycle model – Monoroue électrique by Qwertzu1029
        </a>
        , licensed{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
        Assembled from printable parts, scaled, recoloured, and fitted with
        revised pedals and a headlamp. Generic riders use Quaternius CC0
        Animated Humans.
      </p>
    </main>
  );
}
