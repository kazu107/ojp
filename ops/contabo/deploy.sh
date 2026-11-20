#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Install this reviewed operator script on the VPS; do not execute it from fetched commits.
repo=https://github.com/kazu107/ojp.git
api=https://api.github.com/repos/kazu107/ojp
state=/var/lib/ojp-autodeploy
root=/root/ojp-migration
db=ojp-production-pg
worker=ojp-production-worker.service
route=/data/coolify/proxy/dynamic/ojp-production.yml
dropin=/etc/systemd/system/ojp-production-worker.service.d/20-autodeploy.conf
mode=${1:---poll}
[[ "$mode" == --poll || "$mode" == --prepare || "$mode" == --check ]]
install -d -m 700 "$state" "$state/releases"
exec 9>"$state/lock"
flock -n 9 || exit 0
cd "$state"
say() { printf '%s\n' "$*"; }
fail() { say "$*" >&2; exit 1; }
sha_ok() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
read -r current <current-sha
sha_ok "$current" || fail "Invalid installed commit"
test ! -f needs-recovery || fail "Operator recovery is required before another deployment"
id=$(jq -er '.uuid' "$root/production-service.json")
[[ "$id" =~ ^[a-z0-9]+$ ]] || fail "Invalid production service UUID"
web="web-$id"
tag=$(docker inspect "$web" --format '{{.Config.Image}}')
[[ "$tag" =~ ^ojp-(migration|release):[a-f0-9]+$ ]] || fail "Unexpected live image"
oldroot=$(systemctl show "$worker" -P RootDirectory)
[[ "$oldroot" =~ ^/opt/ojp-worker-[a-f0-9]+$ ]] || fail "Unexpected live worker root"
read -r coolify_user <coolify-user-id
[[ "$coolify_user" =~ ^[0-9]+$ ]] || fail "Invalid local Coolify principal"
main_sha() {
  timeout 60 git -c credential.helper= ls-remote --exit-code "$repo" refs/heads/main |
    awk 'NR==1 && $2=="refs/heads/main" {print $1}'
}
target=$(main_sha)
sha_ok "$target" || fail "Could not verify the current main commit"
if [ "$target" = "$current" ]; then say "Current main is already running: $current"; exit 0; fi

github() {
  curl -fsS --proto '=https' --max-time 25 -H 'Accept: application/vnd.github+json' "$api$1"
}
approved() {
  local checks release jobs
  checks=$(github "/actions/workflows/judge-checks.yml/runs?branch=main&event=push&head_sha=$target&per_page=5") || return 1
  jq -e --arg s "$target" '.workflow_runs[0] | .head_sha==$s and .head_repository.full_name=="kazu107/ojp" and .head_branch=="main" and .event=="push" and .conclusion=="success"' <<<"$checks" >/dev/null || return 1
  release=$(github "/actions/workflows/contabo-deploy.yml/runs?branch=main&event=workflow_run&head_sha=$target&per_page=5" |
    jq -er --arg s "$target" '.workflow_runs[0] | select(.head_sha==$s and .head_branch=="main" and .head_repository.full_name=="kazu107/ojp") | .id') || return 1
  [[ "$release" =~ ^[0-9]+$ ]] || return 1
  jobs=$(github "/actions/runs/$release/jobs") || return 1
  jq -e 'any(.jobs[]; .name=="Authorize release" and .status=="completed" and .conclusion=="success")' <<<"$jobs" >/dev/null
}
if [ "$mode" != --prepare ]; then
  if ! approved; then say "Waiting for GitHub approval of $target"; exit 0; fi
fi
say "Target: $target ($mode)"
[ "$mode" != --check ] || exit 0
test ! -f "releases/$target/failed" || fail "This commit failed previously. Inspect its logs or push a fix."

idle() {
  docker exec -i "$db" psql -XAt -U postgres -d ojp_live -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  (SELECT count(*) FROM "JudgeJob" WHERE status::text IN ('queued','claimed','running')) +
  (SELECT count(*) FROM "PackageJob" WHERE status::text IN ('queued','claimed','running')) +
  (SELECT count(*) FROM "HeuristicRun" WHERE status IN ('queued','running')) +
  (SELECT count(*) FROM "AppState", jsonb_array_elements(snapshot->'contests') c WHERE id='default'
    AND (c->>'startAt')::timestamptz<=now() AND (c->>'endAt')::timestamptz>now());
SQL
}
if [ "$(idle)" != 0 ]; then say "Deferring until active contests and queues finish"; exit 0; fi

if [ ! -d source.git ]; then git init --bare -q source.git; fi
timeout 150 git -C source.git -c credential.helper= fetch --quiet --no-tags "$repo" refs/heads/main:refs/heads/main
git -C source.git merge-base --is-ancestor "$current" "$target" || fail "Refusing a history rewrite"
test "$(git -C source.git rev-parse refs/heads/main)" = "$target" || fail "main moved while fetching"
if ! git -C source.git diff --quiet "$current" "$target" -- prisma prisma.config.ts; then
  fail "This release changes the database schema or migrations; manual database review required"
fi
work="$state/releases/$target"
newtag="ojp-release:$target"
newroot="/opt/ojp-worker-$target"
install -d -m 700 "$work"

candidate_probe() (
  if docker inspect ojp-autodeploy-web-test >/dev/null 2>&1; then fail "Another test container is still present"; fi
  started_db=0
  trap 'docker rm -f ojp-autodeploy-web-test >/dev/null 2>&1 || true; if [ "$started_db" = 1 ]; then docker stop ojp-rehearsal-pg >/dev/null; fi' EXIT
  if [ "$(docker inspect ojp-rehearsal-pg --format '{{.State.Running}}')" != true ]; then
    started_db=1
    docker start ojp-rehearsal-pg >/dev/null
  fi
  test -f "$root/rehearsal-app.env"
  grep -q '^DATABASE_URL=.*@ojp-rehearsal-pg:5432/ojp_rehearsal$' "$root/rehearsal-app.env"
  docker run -d --pull=never --name ojp-autodeploy-web-test --network ojp-rehearsal --user 1000:1000 \
    --cap-drop ALL --security-opt no-new-privileges:true --memory=1g --pids-limit=128 \
    --env-file "$root/rehearsal-app.env" -p 127.0.0.1:23113:3000 "$newtag" >/dev/null
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:23113/api/problems 2>/dev/null |
      jq -e '.problems | length > 0' >/dev/null; then break; fi
    sleep 1
  done
  curl -fsS --max-time 8 http://127.0.0.1:23113/api/health/db | jq -e '.ok == true' >/dev/null
  curl -fsS --max-time 8 http://127.0.0.1:23113/api/problems | jq -e '.problems | length > 0' >/dev/null
  curl -fsS --max-time 8 http://127.0.0.1:23113/ >"$work/rehearsal-health.html"
)

if [ ! -f "$work/prepared" ]; then
  available=$(df -Pm / | awk 'NR==2{print $4}')
  [ "$available" -gt 18000 ] || fail "Insufficient free disk for a candidate and a rollback image"
  mkdir -p "$work/source"
  git -C source.git archive "$target" | tar -xpf - -C "$work/source"
  say "Building $target without production credentials"
  docker build --progress=plain --label "org.opencontainers.image.revision=$target" -t "$newtag" "$work/source" >"$work/build.log" 2>&1
  if [ -e "$newroot" ]; then fail "Unverified worker root already exists. Review $newroot"; fi
  temp_root=$(mktemp -d /opt/ojp-export.XXXXXX)
  chmod 755 "$temp_root"
  container=$(docker create --pull=never --network none "$newtag" /bin/true)
  if ! docker export "$container" | tar --numeric-owner -xpf - -C "$temp_root"; then
    docker rm "$container" >/dev/null
    fail "Candidate worker export failed"
  fi
  docker rm "$container" >/dev/null
  test -x "$temp_root/usr/bin/bwrap"
  mv "$temp_root/usr/bin/bwrap" "$temp_root/usr/bin/ojp-bwrap.real"
  printf '%s\n' '#!/bin/sh' 'exec /usr/bin/ojp-bwrap.real --disable-userns "$@"' >"$temp_root/usr/bin/bwrap"
  chmod 755 "$temp_root/usr/bin/bwrap"
  mv "$temp_root" "$newroot"
  systemd-run --unit="ojp-candidate-${target:0:12}" --collect --wait --pipe \
    --property="RootDirectory=$newroot" --property=WorkingDirectory=/app \
    --property=User=ojpworker --property=Group=ojpworker --property=NoNewPrivileges=yes \
    --property=CapabilityBoundingSet= --property=ProtectSystem=strict --property=PrivateTmp=yes \
    --property=MountAPIVFS=yes --property=PrivateNetwork=yes --property=MemoryMax=2G --property=TasksMax=128 --property=CPUQuota=200% \
    --setenv=JUDGE_SANDBOX=bubblewrap --setenv=STORE_DB_SYNC=0 --setenv=HOME=/tmp \
    --setenv=PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --import tsx scripts/judge-doctor.ts >"$work/judge.log" 2>&1
  candidate_probe
  touch "$work/prepared"
  say "Prepared and tested the candidate image and isolated worker"
fi
[ "$mode" != --prepare ] || exit 0
test "$(main_sha)" = "$target" || fail "main changed during build"
docker image inspect "$newtag" >/dev/null
test -x "$newroot/usr/bin/ojp-bwrap.real"

if [ "$(idle)" != 0 ]; then say "Deferring until active contests and queues finish"; exit 0; fi
systemctl start ojp-postgres-backup.service

coolify_switch() (
  local compose=$1 token header armed=0
  header=$(mktemp "$work/.api.XXXXXX")
  cleanup() {
    if [ "$armed" = 1 ]; then
      docker exec -e "OJP_DEPLOY_USER_ID=$coolify_user" coolify php artisan tinker --execute='$u=App\Models\User::findOrFail((int)getenv("OJP_DEPLOY_USER_ID")); $u->tokens()->where("name","ojp-local-autodeploy")->delete(); App\Models\InstanceSettings::firstOrFail()->forceFill(["is_api_enabled"=>false])->save();' >/dev/null 2>&1 ||
        say "Warning: review temporary Coolify permissions."
    fi
    rm -f "$header"
  }
  trap cleanup EXIT
  token=$(docker exec -e "OJP_DEPLOY_USER_ID=$coolify_user" coolify php artisan tinker --execute='
    $u=App\Models\User::findOrFail((int)getenv("OJP_DEPLOY_USER_ID"));
    $settings=App\Models\InstanceSettings::firstOrFail();
    if($settings->is_api_enabled){throw new RuntimeException("API is already enabled");}
    $token=$u->createToken("ojp-local-autodeploy",["read","write","deploy"],now()->addMinutes(15),$u->teams()->sole()->id);
    $settings->forceFill(["is_api_enabled"=>true])->save(); echo $token->plainTextToken;')
  armed=1
  [[ "$token" =~ ^[0-9]+\|[A-Za-z0-9_]+$ ]] || fail "Coolify token creation failed"
  printf 'Authorization: Bearer %s\n' "$token" >"$header"
  unset token
  jq -n --arg compose "$(base64 -w0 "$compose")" '{docker_compose_raw:$compose,instant_deploy:true}' |
    curl -fsS --max-time 30 -X PATCH -H @"$header" -H 'Content-Type: application/json' --data-binary @- \
      "http://127.0.0.1:8000/api/v1/services/$id" >/dev/null
)
wait_web() {
  local image=$1
  for i in $(seq 1 50); do
    if [ "$(docker inspect "$web" --format '{{.Config.Image}} {{.State.Health.Status}}' 2>/dev/null || true)" = "$image healthy" ] &&
      curl -fsS --max-time 3 http://127.0.0.1:23114/api/health/db 2>/dev/null | jq -e '.ok==true' >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
wait_worker() {
  local dir=$1 inv
  for i in $(seq 1 25); do
    inv=$(systemctl show "$worker" -P InvocationID)
    if [ "$(systemctl is-active "$worker")" = active ] && [ "$(systemctl show "$worker" -P RootDirectory)" = "$dir" ] &&
      journalctl "_SYSTEMD_INVOCATION_ID=$inv" --no-pager -o cat | grep -F 'starting dedicated judge worker loop (sandbox=bubblewrap)' >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
set_route() {
  install -m 600 "$1" /data/coolify/proxy/ojp-autodeploy.next
  mv /data/coolify/proxy/ojp-autodeploy.next "$route"
}
origin_marker() {
  docker run --pull=never --rm --network container:coolify-proxy --entrypoint node \
    --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
    -e NODE_EXTRA_CA_CERTS=/origin-ca.pem \
    -v /data/coolify/proxy/ojp-certs/verification-ca.pem:/origin-ca.pem:ro "$tag" -e '
      const https = require("node:https"), name = "ojp.kazu107.xyz";
      const req = https.get({hostname:"127.0.0.1",servername:name,headers:{Host:name},path:"/api/health/db"},r=>{
        r.resume(); r.on("end",()=>{ if(r.statusCode!==200 || !r.headers["x-ojp-origin"]) process.exit(1);
          console.log(r.headers["x-ojp-origin"]); });
      });
      req.on("error",()=>process.exit(1));req.setTimeout(2500,()=>req.destroy());
    '
}
if [ -f "$work/switching" ]; then fail "A prior switch was interrupted"; fi
cp "$route" "$work/route.old"
test "$(grep -c 'X-OJP-Origin: contabo-' "$work/route.old")" = 1
awk '/^[[:space:]]*sourceRange:/ {print; print "          - \"127.0.0.1/32\""; print "          - \"::1/128\""; skip=1; next} skip && /^[[:space:]]*-/ {next} {skip=0;print}' "$work/route.old" >"$work/route.local"
sed -i -E "s/(X-OJP-Origin: contabo-)[0-9a-f]+/\1$current-gated/" "$work/route.local"
sed -E "s/(X-OJP-Origin: contabo-)[0-9a-f]+/\1$target/" "$work/route.old" >"$work/route.new"
cp "$root/production-compose.yml" "$work/compose.old"
grep -Fxq "    image: $tag" "$work/compose.old" || fail "Production Compose differs from the running service"
sed -E "s@^    image: .+@    image: $newtag@" "$work/compose.old" >"$work/compose.new"
if [ -f "$dropin" ]; then cp "$dropin" "$work/worker.old"; fi
replaced=0
web_stopped=0
rollback() {
  local result=$?
  if [ "$result" -eq 0 ] || [ ! -f "$work/switching" ]; then return; fi
  set +e
  say "Deployment failed before opening public writes. Restoring $current."
  restored=0
  if [ "$replaced" = 1 ]; then
    systemctl stop "$worker"
    if [ -f "$work/worker.old" ]; then install -m 644 "$work/worker.old" "$dropin"; else rm -f "$dropin"; fi
    systemctl daemon-reload
    if coolify_switch "$work/compose.old" && wait_web "$tag" && systemctl start "$worker" && wait_worker "$oldroot"; then restored=1; fi
  elif [ "$web_stopped" = 1 ]; then
    if docker start "$web" >/dev/null && wait_web "$tag"; then restored=1; fi
  else
    restored=1
  fi
  if [ "$restored" = 1 ]; then
    cp "$work/compose.old" "$root/production-compose.yml"
    set_route "$work/route.old"
    rm -f "$work/switching"
    touch "$work/failed"
    say "Previous production release restored."
  else
    touch needs-recovery
    say "Automatic rollback could not confirm health. Public writes remain blocked; see $work."
  fi
}
trap rollback EXIT
trap 'exit 143' TERM INT
touch "$work/switching"
set_route "$work/route.local"
blocked=0
for i in $(seq 1 8); do
  if [ "$(origin_marker || true)" = "contabo-$current-gated" ]; then blocked=1; break; fi
  sleep 1
done
[ "$blocked" = 1 ] || fail "Could not confirm the public write gate"
web_stopped=1
docker stop --time 25 "$web" >/dev/null
if [ "$(idle)" != 0 ]; then
  docker start "$web" >/dev/null
  wait_web "$tag"
  set_route "$work/route.old"
  rm -f "$work/switching"
  say "New work appeared. Deferring this release."
  exit 0
fi
replaced=1
systemctl stop "$worker"
coolify_switch "$work/compose.new"
wait_web "$newtag"
install -d -m 755 "$(dirname "$dropin")"
printf '[Service]\nRootDirectory=%s\n' "$newroot" >"$work/worker.new"
install -m 644 "$work/worker.new" "$dropin"
systemctl daemon-reload
systemctl start "$worker"
wait_worker "$newroot"
cp "$work/compose.new" "$root/production-compose.yml"
set_route "$work/route.new"
printf '%s\n' "$target" >current-sha.next
mv current-sha.next current-sha
rm -f "$work/switching"
say "Production now serves $target with the matching isolated worker"
