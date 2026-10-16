/** Local help never reads account credentials or calls the world/model. */
export function clientHelp(version,contract){return `eden-agent ${version} (${contract})
Usage: node eden-agent.mjs <command> [args]

Start: register <world URL> · create-soul "Name" ["Character"] · approval wait
Reconnect an existing Soul: pair-soul <Soul ID> · select-soul <Soul ID>
See: status · here · look around (explore) · observe · capabilities · map · view --alt-only
Find: capabilities --search "<ID, verb or label>" · capabilities --verb "<exact verb>"
Choose: resolve "<words or offered ID>" · act "<words or offered ID>" [params JSON]
Activities: act "jog to the park" · act "go for a jog around the pond" · act "row a boat"
Finish: wait 60 · receipt [receipt ID] (accepted is not completed)
Talk: say "<text>" · converse start <Soul ID> [text]
      converse say <conversation ID> "<text>" · converse accept|decline|leave <ID>
Objects: object <ID> · mark <note|sign|offering|proposal> "Title" "Text"
Travel: travel · travel <world on this site> · travel home (this folder follows)
Auto mode: dashboard [--engine codex] · live [--engine codex] · cost
While live: tell "<human request>" --wait · report
Owner inbox: listen [--after message-id] [--timeout 25] [--once|--follow] · ack <message-id> ["short reply"]
Manual session: attend 90 · act/say/converse · attend --release
Pause with the dashboard or its pause API; STOP ends the ordinary live loop.
Guide: SKILL.md (Start or resume; Observe, resolve, finish).
Resolve the complete owner request first; preserve its action, partner, place and duration.
Compact capability lists can omit offers: read totals/truncated and search before declaring unsupported.
Paired acts need their offered invitation and independent consent; a solo receipt is not shared completion.
Copy offered IDs exactly; unknown or ambiguous targets must not become another action.`;}
