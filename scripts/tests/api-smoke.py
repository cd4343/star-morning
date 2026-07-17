"""Phase 11 isolated API acceptance checks. Never point this at production."""

import base64
import json
import os
import sys
import urllib.error
import urllib.request


BASE = os.environ.get("STARCOIN_API_BASE", "http://127.0.0.1:3199/api").rstrip("/")
if "127.0.0.1" not in BASE and "localhost" not in BASE:
    raise SystemExit("STARCOIN_API_BASE must target localhost")

failures = []


def call(method, path, body=None, token=None):
    request = urllib.request.Request(BASE + path, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(request, data, timeout=10) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            return error.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return error.code, {"raw": raw}


def check(name, condition, detail=""):
    if condition:
        print(f"[OK] {name}")
    else:
        failures.append(f"{name}: {detail}")
        print(f"[FAIL] {name}: {detail}")


status, health = call("GET", "/health")
check("database-aware health", status == 200 and health.get("database") == "ok", f"{status} {health}")

status, sms = call("POST", "/auth/sms/send", {"phone": "13900000111", "purpose": "register"})
code = str(sms.get("devCode") or "")
check("development SMS code", status == 200 and len(code) == 6, f"{status} {sms}")

status, registration = call("POST", "/auth/register", {
    "phone": "13900000111", "password": "phase11-test", "smsCode": code,
})
parent_token = registration.get("token", "")
check("register parent", status in (200, 201) and parent_token.count(".") == 2, f"{status} {registration}")
if parent_token:
    payload = json.loads(base64.urlsafe_b64decode(parent_token.split(".")[1] + "==="))
    check("JWT expires", "exp" in payload, str(payload.keys()))

status, family = call("POST", "/auth/create-family", {
    "familyName": "Phase 11 Family", "parentName": "Parent", "parentRole": "dad",
    "childName": "Child", "childGender": "boy",
}, parent_token)
parent_token = family.get("token", parent_token)
check("create family", status == 200 and bool(parent_token), f"{status} {family}")

status, members = call("GET", "/auth/members", token=parent_token)
child = next((item for item in members if item.get("role") == "child"), {}) if isinstance(members, list) else {}
check("family child exists", status == 200 and bool(child.get("id")), f"{status} {members}")
check("member response hides secrets", "pin" not in child and "password" not in child, str(child.keys()))

status, switched = call("POST", "/auth/switch-user", {"targetUserId": child.get("id")}, parent_token)
child_token = switched.get("token", "")
check("switch to child", status == 200 and bool(child_token), f"{status} {switched}")

status, task = call("POST", "/parent/tasks", {
    "title": "Phase 11 learning task", "category": "学习", "coinReward": 10,
    "xpReward": 10, "durationMinutes": 10, "icon": "📘",
}, parent_token)
task_id = task.get("id") or (task.get("task") or {}).get("id")
check("parent creates learning task", status == 200 and bool(task_id), f"{status} {task}")

status, started = call("POST", f"/child/tasks/{task_id}/start", {}, child_token)
check("child starts task", status == 200, f"{status} {started}")

status, submitted = call("POST", f"/child/tasks/{task_id}/complete", {"duration": 5}, child_token)
entry_id = submitted.get("entryId")
check("child submits task", status == 200 and bool(entry_id), f"{status} {submitted}")
check("immediate chest result returned", "chest" in submitted and not submitted.get("chestRetryRequired"), str(submitted))

status, chest_records = call("GET", "/child/chest-records", token=child_token)
check("exactly one chest record", status == 200 and len(chest_records) == 1, f"{status} {len(chest_records) if isinstance(chest_records, list) else chest_records}")

status, duplicate_submit = call("POST", f"/child/tasks/{task_id}/complete", {"duration": 5}, child_token)
check("duplicate task submission rejected", status == 409, f"{status} {duplicate_submit}")
status, chest_records_after = call("GET", "/child/chest-records", token=child_token)
check("duplicate submission creates no chest", status == 200 and len(chest_records_after) == 1, f"{status} {chest_records_after}")

status, before_review = call("GET", "/child/dashboard", token=child_token)
coins_before_review = int((before_review.get("child") or {}).get("coins") or 0)
status, reviewed = call("POST", f"/parent/review/{entry_id}", {"action": "approve"}, parent_token)
check("parent approves task", status == 200 and reviewed.get("coinsAwarded") == 10, f"{status} {reviewed}")
status, after_review = call("GET", "/child/dashboard", token=child_token)
coins_after_review = int((after_review.get("child") or {}).get("coins") or 0)
check(
    "approval includes the task coin settlement",
    coins_after_review - coins_before_review >= reviewed.get("coinsAwarded", 0),
    f"{coins_before_review}->{coins_after_review}, settlement={reviewed.get('coinsAwarded')}",
)

status, duplicate_review = call("POST", f"/parent/review/{entry_id}", {"action": "approve"}, parent_token)
status2, after_duplicate = call("GET", "/child/dashboard", token=child_token)
coins_after_duplicate = int((after_duplicate.get("child") or {}).get("coins") or 0)
check("duplicate approval replays settlement", status == 200 and duplicate_review.get("alreadyReviewed") is True, f"{status} {duplicate_review}")
check("duplicate approval adds no coins", status2 == 200 and coins_after_duplicate == coins_after_review, f"{coins_after_review}->{coins_after_duplicate}")

status, wish = call("POST", "/child/wish-requests", {
    "title": "Visit the planetarium", "icon": "🔭", "description": "See the moon",
}, child_token)
check("child creates one active wish", status == 201 and bool(wish.get("id")), f"{status} {wish}")
status, second_wish = call("POST", "/child/wish-requests", {"title": "Second wish"}, child_token)
check("second active wish rejected", status == 409, f"{status} {second_wish}")

status, intents = call("PUT", "/child/explore/intents", {"selections": ["museum", "animals"]}, child_token)
check("child saves two explore intents", status == 200 and intents.get("selections") == ["museum", "animals"], f"{status} {intents}")
status, too_many = call("PUT", "/child/explore/intents", {"selections": ["museum", "animals", "handcraft"]}, child_token)
check("third explore intent rejected", status == 400, f"{status} {too_many}")

status, pending_explore = call("POST", "/parent/explore/feed/push", {"title": "Incomplete place"}, parent_token)
pending_id = pending_explore.get("id")
check("incomplete explore item stays parent-only", status == 200 and pending_explore.get("visibleToChild") is False, f"{status} {pending_explore}")
status, child_feed = call("GET", "/child/explore/feed", token=child_token)
visible_ids = {item.get("id") for item in child_feed} if isinstance(child_feed, list) else set()
check("incomplete explore item hidden from child", status == 200 and pending_id not in visible_ids, f"{status} {visible_ids}")

if failures:
    print(f"\nPhase 11 API acceptance failed: {len(failures)} check(s)")
    for failure in failures:
        print(f" - {failure}")
    sys.exit(1)

print("\nPhase 11 API acceptance passed")
