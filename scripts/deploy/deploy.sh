#!/usr/bin/env bash
# Debian + Docker, one published port. Existing matches are protected by the server's admission lease.
set -Eeuo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="${SP_DEPLOY_ROOT:-$(cd -- "$script_dir/../.." && pwd)}"
name="${SP_CONTAINER_NAME:-stronghold}"
port="${SP_PUBLIC_PORT:-3000}"
bind_address="${SP_BIND_ADDRESS:-0.0.0.0}"
wait_seconds="${SP_DEPLOY_WAIT_SECONDS:-600}"
previous="${name}-previous"
candidate="${name}-candidate"
env_file="$root/server.env"
shared="$root/shared"

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$root" == /* && "$root" != / ]] || die 'SP_DEPLOY_ROOT must be an absolute application directory'
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,60}$ ]] || die 'Invalid container name'
[[ "$port" =~ ^[0-9]{1,5}$ && "$port" -ge 1 && "$port" -le 65535 ]] || die 'Invalid public port'
[[ "$bind_address" == 0.0.0.0 || "$bind_address" == 127.0.0.1 ]] || die 'Bind address must be 0.0.0.0 or 127.0.0.1'
[[ "$wait_seconds" =~ ^[0-9]{1,4}$ && "$wait_seconds" -le 1800 ]] || die 'Invalid wait interval (0..1800 seconds)'
[[ -f "$env_file" && -d "$shared/assets" && -d "$shared/fonts" && -d "$shared/plugins" ]] \
  || die 'Prepare server.env and shared/{assets,fonts,plugins} first; see docs/DEPLOY-FORK.md'
command -v docker >/dev/null || die 'Docker is required'
command -v flock >/dev/null || die 'flock (util-linux) is required'
exec 9>"$root/deploy.lock"
flock -n 9 || die 'Another deployment is running'

exists() { docker container inspect "$1" >/dev/null 2>&1; }
owned() { [[ "$(docker container inspect --format '{{index .Config.Labels "io.stronghold.managed"}}' "$1")" == true ]]; }
probe() { docker exec -i "$1" node --input-type=module - "$2" "${3:-}" < "$script_dir/container-probe.mjs"; }
wait_ready() {
  local container="$1" sha="${2:-}"
  for ((i=0; i<30; i++)); do
    if probe "$container" ready "$sha" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

operation="${1:-}"
if [[ "$operation" == rollback ]]; then
  exists "$previous" && owned "$previous" || die 'No managed previous release is available'
  image="$(docker container inspect --format '{{.Config.Image}}' "$previous")"
  sha="$(docker container inspect --format '{{index .Config.Labels "io.stronghold.release"}}' "$previous")"
elif [[ "$operation" == deploy ]]; then
  image="${2:-}" sha="${3:-}"
else
  die 'Usage: deploy.sh deploy ghcr.io/OWNER/REPO@sha256:DIGEST COMMIT_SHA | rollback'
fi
[[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || die 'An immutable GHCR image digest is required'
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || die 'A full commit SHA is required'

old_moved=0
old_stopped=0
gate_set=0
candidate_created=0
new_created=0
cleanup() {
  local result=$?
  trap - EXIT
  if (( candidate_created )); then docker rm -f "$candidate" >/dev/null || true; fi
  if (( old_moved )); then
    printf '%s\n' 'Deployment failed; restoring the previous container' >&2
    if (( new_created )); then docker rm -f "$name" >/dev/null || true; fi
    if docker rename "$previous" "$name" && docker start "$name" >/dev/null && wait_ready "$name"; then
      printf '%s\n' 'Previous container restored' >&2
    else
      printf '%s\n' 'ROLLBACK FAILED: inspect the retained containers and Docker logs' >&2
      result=1
    fi
  elif (( old_stopped )); then
    docker start "$name" >/dev/null || result=1
  fi
  if (( gate_set )) && exists "$name"; then probe "$name" resume >/dev/null || true; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Never overwrite an unmanaged container or an unexplained leftover candidate.
if exists "$candidate"; then die "Inspect leftover container $candidate before retrying"; fi
if exists "$name"; then owned "$name" || die "Container $name is unmanaged; migrate it explicitly first"; fi
if exists "$previous"; then
  owned "$previous" || die "Container $previous is unmanaged"
  [[ "$(docker container inspect --format '{{.State.Running}}' "$previous")" == false ]] || die 'Previous container is still running'
fi

# Retained digest images also support an offline manual rollback, after the Actions token has expired.
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$sha" ]] \
  || die 'Image revision does not match the requested commit'
mounts=(--mount "type=bind,src=$shared/assets,dst=/app/public/assets,readonly"
  --mount "type=bind,src=$shared/fonts,dst=/app/public/fonts,readonly")
# Only art manifests are persistent. Mounting all of data/ would shadow the new release's game data.
for manifest in assets local-assets local-fx; do
  if [[ -f "$shared/$manifest.json" ]]; then
    mounts+=(--mount "type=bind,src=$shared/$manifest.json,dst=/app/data/$manifest.json,readonly")
  fi
done
if [[ -f "$shared/site-config.json" ]]; then
  mounts+=(--mount "type=bind,src=$shared/site-config.json,dst=/app/public/site-config.json,readonly")
fi
common=(--env-file "$env_file" --env PORT=3000 --env HOST=0.0.0.0 --env "SP_RELEASE_SHA=$sha"
  --label io.stronghold.managed=true --label "io.stronghold.release=$sha"
  --memory 768m --memory-swap 768m --cpus 1 --pids-limit 128 --init
  --log-opt max-size=10m --log-opt max-file=3)
candidate_created=1
docker run -d --name "$candidate" "${common[@]}" "${mounts[@]}" \
  --mount "type=bind,src=$shared/plugins,dst=/app/plugins,readonly" \
  --env SP_STUDIO=off --env SP_ASSET_INDEX=0 "$image" >/dev/null
wait_ready "$candidate" "$sha" || die 'Candidate did not start; live container unchanged'
probe "$candidate" smoke "$sha" || die 'Candidate smoke failed; live container unchanged'
docker rm -f "$candidate" >/dev/null
candidate_created=0

if exists "$name"; then
  # The gate and match count are checked in this order so no new match can race with the cutover.
  gate_set=1
  deadline=$((SECONDS + wait_seconds))
  while true; do
    if probe "$name" drain; then break; else status=$?; fi
    [[ "$status" == 10 ]] || die 'Cannot verify the live admission gate; refusing to stop it'
    if (( SECONDS >= deadline )); then
      printf '%s\n' 'Live matches remain; deployment postponed and the live container is unchanged' >&2
      exit 75
    fi
    sleep 15
  done
  if exists "$previous"; then docker rm "$previous" >/dev/null; fi
  probe "$name" drain || die 'Admission or match state changed before cutover; live container unchanged'
  old_stopped=1
  docker stop --time 30 "$name" >/dev/null
  docker rename "$name" "$previous"
  old_moved=1
fi

new_created=1
docker run -d --name "$name" --restart unless-stopped "${common[@]}" "${mounts[@]}" \
  --mount "type=bind,src=$shared/plugins,dst=/app/plugins" -p "$bind_address:$port:3000" "$image" >/dev/null
wait_ready "$name" "$sha" || die 'New live container did not become ready'
probe "$name" smoke "$sha" || die 'New live container failed its smoke check'
old_moved=0
old_stopped=0
gate_set=0
printf 'Deployed %s (%s); rollback: SP_DEPLOY_ROOT=%q SP_CONTAINER_NAME=%q SP_PUBLIC_PORT=%q SP_BIND_ADDRESS=%q bash %q rollback\n' \
  "$sha" "$image" "$root" "$name" "$port" "$bind_address" "$0"
