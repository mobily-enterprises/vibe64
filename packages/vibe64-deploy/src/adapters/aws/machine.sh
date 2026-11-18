# Made by Vibe64: runs one service's image on this machine (the line above names where its spec is), then says it is ready.
set -euo pipefail
dnf install -y -q docker jq
systemctl enable --now docker
token="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 900' http://169.254.169.254/latest/api/token)"
imds() { curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/$1"; }
read -r spec_uri spec_sha < <(imds user-data | sed -n 's/^# vibe64-spec //p')
region="$(imds meta-data/placement/region)"
spec="$(aws s3 cp "$spec_uri" - --region "$region")"
if [ "$(printf '%s' "$spec" | sha256sum | cut -d ' ' -f 1)" != "$spec_sha" ]; then
  echo "The spec at $spec_uri is not the one this machine's user data names." >&2
  exit 1
fi
field() { jq -r --arg name "$1" '.[$name]' <<<"$spec"; }
port="$(field port)"
V64_INSTANCE_ID="$(imds meta-data/instance-id)"
V64_PRIVATE_ADDRESS="$(imds meta-data/local-ipv4)"
export V64_INSTANCE_ID V64_PRIVATE_ADDRESS
export V64_INSTANCE_URL="http://$V64_PRIVATE_ADDRESS:$port"
export V64_WORK_DIR=/srv/work
mkdir -p "$V64_WORK_DIR" && chown 10001:10001 "$V64_WORK_DIR"
names=(V64_INSTANCE_ID V64_PRIVATE_ADDRESS V64_INSTANCE_URL V64_WORK_DIR)
while IFS= read -r name; do
  value="$(jq -r --arg name "$name" '.env[$name]' <<<"$spec")"
  export "$name=$value"
  names+=("$name")
done < <(jq -r '.env | keys[]' <<<"$spec")
while IFS=$'\t' read -r name arn key version; do
  value="$(aws secretsmanager get-secret-value --region "$region" --secret-id "$arn" ${version:+--version-id "$version"} \
    --query SecretString --output text | jq -er --arg key "$key" '.[$key]')"
  export "$name=$value"
  names+=("$name")
done < <(jq -r '.secrets | to_entries[] | [.key, .value.arn, .value.key, (.value.versionId // "")] | @tsv' <<<"$spec")
image="$(field image)"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${image%%/*}"
flags=()
if [ "$(field privileged)" = true ]; then flags+=(--privileged); fi
for name in "${names[@]}"; do flags+=(-e "$name"); done
docker run -d --name app --restart unless-stopped --network host -v /srv/work:/srv/work "${flags[@]}" \
  --log-driver awslogs --log-opt "awslogs-region=$region" --log-opt "awslogs-group=$(field logGroup)" \
  --log-opt "awslogs-stream=$(field service)/$V64_INSTANCE_ID" "$image"
until curl -fsS -o /dev/null "http://127.0.0.1:$port$(field healthPath)"; do sleep 5; done
# The machine in the deployment's private names while its service runs: a container that adds it once the service's
# port answers (again after a reboot, by Docker's restart policy) and takes it out as Docker stops it at shutdown,
# before the machine's network goes. Nothing is written outside Docker.
names="--region $region --service-id $(field namesService) --instance-id $V64_INSTANCE_ID"
docker run -d --name names --restart unless-stopped --stop-timeout 30 --network host --entrypoint /bin/bash "$(field namesImage)" -c \
  "until (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; do sleep 5; done
aws servicediscovery register-instance $names --attributes AWS_INSTANCE_IPV4=$V64_PRIVATE_ADDRESS,AWS_INSTANCE_PORT=$port
trap 'aws servicediscovery deregister-instance $names; exit 0' TERM
while :; do sleep 3600 & wait \$!; done"
aws autoscaling complete-lifecycle-action --region "$region" --auto-scaling-group-name "$(field group)" --lifecycle-hook-name vibe64-ready \
  --instance-id "$V64_INSTANCE_ID" --lifecycle-action-result CONTINUE
