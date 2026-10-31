# shellcheck shell=bash
# Deploy settings for the shell deploy scripts. Source it; values come from the environment first, then from the
# untracked deploy.env at the repo root (SIM_DEPLOY_ENV names another file). Template: deploy.env.example.
_deploy_env_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || true)"
_deploy_env_file="${SIM_DEPLOY_ENV:-${_deploy_env_root:+$_deploy_env_root/deploy.env}}"
if [ -n "$_deploy_env_file" ] && [ -f "$_deploy_env_file" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in ''|'#'*) continue;; esac
    _key="${_line%%=*}"; _val="${_line#*=}"
    [[ "$_line" == *=* && "$_key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "$_deploy_env_file: not KEY=value: $_line" >&2; exit 2; }
    _val="${_val%\"}"; _val="${_val#\"}"; _val="${_val%\'}"; _val="${_val#\'}"
    [ -n "${!_key+x}" ] || export "$_key=$_val"
  done < "$_deploy_env_file"
fi
unset _deploy_env_root _line _key _val

# deploy_target: the SSH target of the world-launcher box, [SIM_DEPLOY_USER@]SIM_DEPLOY_HOST (SIM_WORLDS_HOST, a full
# user@host, still overrides both). Exits with a clear message when nothing is configured.
deploy_target() {
  if [ -n "${SIM_WORLDS_HOST:-}" ]; then echo "$SIM_WORLDS_HOST"; return; fi
  if [ -z "${SIM_DEPLOY_HOST:-}" ]; then
    echo "SIM_DEPLOY_HOST is not set: export it or put it in ${_deploy_env_file:-deploy.env} (template: deploy.env.example)" >&2
    exit 2
  fi
  echo "${SIM_DEPLOY_USER:+$SIM_DEPLOY_USER@}$SIM_DEPLOY_HOST"
}
