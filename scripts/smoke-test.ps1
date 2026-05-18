param(
  [int]$Port = 3131
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $root "backend"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$dbPath = Join-Path "C:\tmp" "starcoin-smoke-$stamp.db"
$stdoutLog = Join-Path "C:\tmp" "starcoin-smoke-$stamp.out.log"
$stderrLog = Join-Path "C:\tmp" "starcoin-smoke-$stamp.err.log"
$baseUrl = "http://localhost:$Port/api"
$server = $null

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "ASSERT FAILED: $Message"
  }
}

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )

  $params = @{
    Method = $Method
    Uri = "$baseUrl$Path"
    Headers = $Headers
    TimeoutSec = 15
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json; charset=utf-8"
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10))
  }
  Invoke-RestMethod @params
}

try {
  New-Item -ItemType Directory -Force -Path "C:\tmp" | Out-Null

  $oldPort = $env:PORT
  $oldNodeEnv = $env:NODE_ENV
  $oldSecret = $env:JWT_SECRET
  $oldDbPath = $env:STARCOIN_DB_PATH
  $oldBackup = $env:ENABLE_DB_BACKUP

  $env:PORT = "$Port"
  $env:NODE_ENV = "test"
  $env:JWT_SECRET = "starcoin-smoke-secret-$stamp"
  $env:STARCOIN_DB_PATH = $dbPath
  $env:ENABLE_DB_BACKUP = "false"

  $server = Start-Process -FilePath "node" `
    -ArgumentList "dist/server.js" `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  $ready = $false
  for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-Json -Method "GET" -Path "/health"
      if ($health.status -eq "ok") {
        $ready = $true
        break
      }
    } catch {}
  }
  Assert-True $ready "backend did not become healthy"

  $phone = "139" + (Get-Random -Minimum 10000000 -Maximum 99999999)
  $password = "SmokePwd123"
  $newPassword = "SmokePwd456"
  $pin = "2468"

  $register = Invoke-Json -Method "POST" -Path "/auth/register" -Body @{ email = $phone; password = $password }
  Assert-True ([bool]$register.token) "register should return token"
  $parentHeaders = @{ Authorization = "Bearer $($register.token)" }

  $family = Invoke-Json -Method "POST" -Path "/auth/create-family" -Headers $parentHeaders -Body @{
    familyName = "Smoke Family"
    parentName = "Smoke Parent"
    parentRole = "dad"
    childName = "Smoke Child"
    childGender = "boy"
    childBirthdate = "2018-01-01"
  }
  Assert-True ([bool]$family.token) "create-family should return updated token"
  $parentHeaders = @{ Authorization = "Bearer $($family.token)" }

  Invoke-Json -Method "POST" -Path "/parent/set-pin" -Headers $parentHeaders -Body @{ pin = $pin } | Out-Null

  $members = Invoke-Json -Method "GET" -Path "/auth/members" -Headers $parentHeaders
  $parent = @($members | Where-Object { $_.role -eq "parent" })[0]
  $child = @($members | Where-Object { $_.role -eq "child" })[0]
  Assert-True ($parent.hasPin -eq $true) "auth members should expose hasPin"
  Assert-True (-not ($parent.PSObject.Properties.Name -contains "pin")) "auth members must not expose raw pin"
  Assert-True ([bool]$child.id) "family should contain child"

  $blocked = $false
  try {
    Invoke-Json -Method "GET" -Path "/parent/learning-quests" | Out-Null
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $blocked = $status -eq 401 -or $status -eq 403
  }
  Assert-True $blocked "parent route should reject unauthenticated requests"

  $switchChild = Invoke-Json -Method "POST" -Path "/auth/switch-user" -Headers $parentHeaders -Body @{ targetUserId = $child.id }
  $childHeaders = @{ Authorization = "Bearer $($switchChild.token)" }
  $switchParent = Invoke-Json -Method "POST" -Path "/child/switch-to-parent" -Headers $childHeaders -Body @{ pin = $pin }
  Assert-True ($switchParent.user.role -eq "parent") "child should switch back to parent with pin"

  Invoke-Json -Method "POST" -Path "/auth/reset-password" -Body @{ phone = $phone; pin = $pin; newPassword = $newPassword } | Out-Null
  $login = Invoke-Json -Method "POST" -Path "/auth/login" -Body @{ phone = $phone; password = $newPassword }
  Assert-True ([bool]$login.token) "login with reset password should work"

  $quest = Invoke-Json -Method "POST" -Path "/parent/learning-quests" -Headers $parentHeaders -Body @{
    title = "Smoke Quest"
    subject = "math"
    estimatedMinutes = 5
    resistanceLevel = "medium"
    steps = @(
      @{ title = "Read"; minutes = 1; coins = 1; xp = 1; prompt = "Read once" },
      @{ title = "Solve"; minutes = 1; coins = 1; xp = 1; prompt = "Solve one" }
    )
  }
  Assert-True ([bool]$quest.id) "learning quest should be created"

  $childQuests = Invoke-Json -Method "GET" -Path "/child/learning-quests" -Headers $childHeaders
  $childQuest = @($childQuests | Where-Object { $_.id -eq $quest.id })[0]
  Assert-True ([bool]$childQuest.id) "child should see learning quest"

  $session = Invoke-Json -Method "POST" -Path "/child/learning-quests/$($quest.id)/start" -Headers $childHeaders
  Invoke-Json -Method "POST" -Path "/child/learning-sessions/$($session.id)/progress" -Headers $childHeaders -Body @{ currentStepIndex = 1 } | Out-Null
  Invoke-Json -Method "POST" -Path "/child/learning-sessions/$($session.id)/submit" -Headers $childHeaders -Body @{ proof = "done" } | Out-Null
  $pending = Invoke-Json -Method "GET" -Path "/parent/learning-sessions?status=pending" -Headers $parentHeaders
  Assert-True (@($pending | Where-Object { $_.id -eq $session.id }).Count -eq 1) "parent should see pending learning session"
  Invoke-Json -Method "POST" -Path "/parent/learning-sessions/$($session.id)/review" -Headers $parentHeaders -Body @{ action = "approve" } | Out-Null

  $morning = Invoke-Json -Method "GET" -Path "/child/morning" -Headers $childHeaders
  Assert-True (@($morning.items).Count -gt 0) "morning should seed breakfast options"
  $today = Get-Date -Format "yyyy-MM-dd"
  $freeOptions = @($morning.items | Where-Object { [int]$_.costCoins -eq 0 })
  Assert-True ($freeOptions.Count -ge 1) "morning should seed free breakfast"
  $freeBreakfast = $freeOptions[0]
  $optionBreakfast = if ($freeOptions.Count -gt 1) { $freeOptions[1] } else { $freeOptions[0] }
  $breakfastPlan = Invoke-Json -Method "POST" -Path "/parent/breakfast-plans" -Headers $parentHeaders -Body @{
    childId = $child.id
    planDate = $today
    defaultItemId = $freeBreakfast.id
    optionItemIds = @($optionBreakfast.id)
    note = "smoke breakfast plan"
  }
  Assert-True ([bool]$breakfastPlan.id) "parent should save breakfast plan"
  $parentPlans = Invoke-Json -Method "GET" -Path "/parent/breakfast-plans?startDate=$today&endDate=$today" -Headers $parentHeaders
  Assert-True (@($parentPlans.plans | Where-Object { $_.id -eq $breakfastPlan.id }).Count -eq 1) "parent should list breakfast plan"
  $plannedMorning = Invoke-Json -Method "GET" -Path "/child/morning" -Headers $childHeaders
  Assert-True ($plannedMorning.plan.id -eq $breakfastPlan.id) "child morning should include breakfast plan"
  Assert-True (@($plannedMorning.items | Where-Object { $_.id -eq $freeBreakfast.id }).Count -eq 1) "child morning should show planned breakfast options"
  $breakfastOrder = Invoke-Json -Method "POST" -Path "/child/breakfast-orders" -Headers $childHeaders -Body @{ itemIds = @($freeBreakfast.id, $optionBreakfast.id); date = $today }
  Assert-True (@($breakfastOrder.order.itemIds).Count -ge 1) "breakfast order should save selected breakfast item ids"

  Invoke-Json -Method "PUT" -Path "/parent/screen-time-rules" -Headers $parentHeaders -Body @{
    isEnabled = $true
    dailyBaseMinutes = 0
    dailyMaxMinutes = 120
    ticketMinutes = 10
    weekdayAllowedStart = "00:00"
    weekdayAllowedEnd = "23:59"
    weekendAllowedStart = "00:00"
    weekendAllowedEnd = "23:59"
  } | Out-Null
  Invoke-Json -Method "POST" -Path "/parent/screen-time/grant" -Headers $parentHeaders -Body @{ childId = $child.id; minutes = 15; reason = "smoke" } | Out-Null
  $screen = Invoke-Json -Method "POST" -Path "/child/screen-time/start" -Headers $childHeaders -Body @{ minutes = 5 }
  Assert-True ([bool]$screen.activeSession.id) "child should start screen time"
  Invoke-Json -Method "POST" -Path "/child/screen-time/sessions/$($screen.activeSession.id)/finish" -Headers $childHeaders -Body @{ status = "completed" } | Out-Null
  $today = Get-Date -Format "yyyy-MM-dd"
  $screenSessions = Invoke-Json -Method "GET" -Path "/parent/screen-time-records?type=session&startDate=$today&endDate=$today" -Headers $parentHeaders
  Assert-True (@($screenSessions | Where-Object { $_.id -eq $screen.activeSession.id }).Count -eq 1) "screen-time records should include completed session"
  $screenGrants = Invoke-Json -Method "GET" -Path "/parent/screen-time-records?type=grant&startDate=$today&endDate=$today" -Headers $parentHeaders
  Assert-True (@($screenGrants | Where-Object { $_.minutes -gt 0 }).Count -ge 1) "screen-time records should include parent grant"
  $cooldownBlocked = $false
  try {
    Invoke-Json -Method "POST" -Path "/child/screen-time/start" -Headers $childHeaders -Body @{ minutes = 5 } | Out-Null
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $cooldownBlocked = $status -eq 400
  }
  Assert-True $cooldownBlocked "screen time should enforce cooldown after a session ends"

  $calm = Invoke-Json -Method "POST" -Path "/child/emotion-checkins" -Headers $childHeaders -Body @{
    scene = "angry"
    intensity = "medium"
    action = "breath"
    helped = $true
  }
  Assert-True ($calm.xpAwarded -ge 0) "emotion checkin should be recorded"
  $filteredCheckins = Invoke-Json -Method "GET" -Path "/parent/emotion-checkins?scene=angry&intensity=medium&helped=true" -Headers $parentHeaders
  Assert-True (@($filteredCheckins | Where-Object { $_.scene -eq "angry" -and $_.helped -eq 1 }).Count -ge 1) "emotion checkin filters should return matching records"
  $emptyCheckins = Invoke-Json -Method "GET" -Path "/parent/emotion-checkins?scene=study&helped=true" -Headers $parentHeaders
  Assert-True (@($emptyCheckins).Count -eq 0) "emotion checkin filters should exclude non-matching records"

  $learningCategoryName = "$([char]0x5B66)$([char]0x4E60)"
  $filterTask = Invoke-Json -Method "POST" -Path "/parent/tasks" -Headers $parentHeaders -Body @{
    title = "Smoke Filter Task"
    coinReward = 5
    xpReward = 12
    durationMinutes = 10
    category = $learningCategoryName
    icon = "馃摌"
    taskType = "once"
  }
  Assert-True ([bool]$filterTask.id) "filter task should be created"
  $completedTask = Invoke-Json -Method "POST" -Path "/child/tasks/$($filterTask.id)/complete" -Headers $childHeaders -Body @{ duration = 7; isOverdue = $false }
  Assert-True ([bool]$completedTask.entryId) "normal task completion should create an entry"

  $today = Get-Date -Format "yyyy-MM-dd"
  $chestRecords = Invoke-Json -Method "GET" -Path "/child/chest-records?startDate=$today&endDate=$today" -Headers $childHeaders
  $createdChest = @($chestRecords | Where-Object { $_.taskTitle -eq "Smoke Filter Task" })[0]
  Assert-True ([bool]$createdChest.id) "chest records should include task title for completed task"
  $filteredChests = Invoke-Json -Method "GET" -Path "/child/chest-records?rewardType=$($createdChest.rewardType)&startDate=$today&endDate=$today" -Headers $childHeaders
  Assert-True (@($filteredChests | Where-Object { $_.id -eq $createdChest.id }).Count -eq 1) "chest record filters should return matching records"

  Invoke-Json -Method "POST" -Path "/parent/review/$($completedTask.entryId)" -Headers $parentHeaders -Body @{
    action = "approve"
    timeScore = 0
    qualityScore = 0
    initiativeScore = 0
  } | Out-Null
  $learningCategory = [uri]::EscapeDataString($learningCategoryName)
  $reviewHistory = Invoke-Json -Method "GET" -Path "/parent/review-history?status=approved&category=$learningCategory" -Headers $parentHeaders
  if (@($reviewHistory.records | Where-Object { $_.id -eq $completedTask.entryId }).Count -ne 1) {
    $allReviewHistory = Invoke-Json -Method "GET" -Path "/parent/review-history" -Headers $parentHeaders
    Write-Host "Filtered review history:" ($reviewHistory | ConvertTo-Json -Depth 8)
    Write-Host "All review history:" ($allReviewHistory | ConvertTo-Json -Depth 8)
  }
  Assert-True (@($reviewHistory.records | Where-Object { $_.id -eq $completedTask.entryId }).Count -eq 1) "review history filters should return approved learning task"
  $reviewHistoryRange = Invoke-Json -Method "GET" -Path "/parent/review-history?startDate=$today&endDate=$today&status=approved&category=$learningCategory" -Headers $parentHeaders
  Assert-True (@($reviewHistoryRange.records | Where-Object { $_.id -eq $completedTask.entryId }).Count -eq 1) "review history date range filters should return approved task"
  $rejectedHistory = Invoke-Json -Method "GET" -Path "/parent/review-history?status=rejected&category=$learningCategory" -Headers $parentHeaders
  Assert-True (@($rejectedHistory.records | Where-Object { $_.id -eq $completedTask.entryId }).Count -eq 0) "review history status filter should exclude approved task"

  $forgotTask = Invoke-Json -Method "POST" -Path "/parent/tasks" -Headers $parentHeaders -Body @{
    title = "Smoke Forgot End Task"
    coinReward = 4
    xpReward = 8
    durationMinutes = 6
    category = $learningCategoryName
    icon = "clock"
    taskType = "once"
  }
  Assert-True ([bool]$forgotTask.id) "forgot-end task should be created"
  $taskStart = Invoke-Json -Method "POST" -Path "/child/tasks/$($forgotTask.id)/start" -Headers $childHeaders
  Assert-True ([bool]$taskStart.session.id) "child should start a normal task session"
  & sqlite3 $dbPath "UPDATE task_sessions SET startedAt = '2000-01-01T01:00:00.000Z' WHERE id = '$($taskStart.session.id)';" | Out-Null
  $childReminders = Invoke-Json -Method "GET" -Path "/child/task-session-reminders" -Headers $childHeaders
  $childReminder = @($childReminders | Where-Object { $_.taskId -eq $forgotTask.id })[0]
  Assert-True ([bool]$childReminder.id) "child should see auto-completed task reminder"
  $parentReminders = Invoke-Json -Method "GET" -Path "/parent/task-session-reminders" -Headers $parentHeaders
  Assert-True (@($parentReminders | Where-Object { $_.taskId -eq $forgotTask.id }).Count -eq 1) "parent should see auto-completed task reminder"
  $parentDashboardAfterAuto = Invoke-Json -Method "GET" -Path "/parent/dashboard" -Headers $parentHeaders
  Assert-True (@($parentDashboardAfterAuto.pendingReviews | Where-Object { $_.title -eq "Smoke Forgot End Task" -and [int]$_.autoCompleted -eq 1 }).Count -eq 1) "auto-completed task should become a pending review"
  Invoke-Json -Method "POST" -Path "/child/task-session-reminders/$($childReminder.id)/read" -Headers $childHeaders | Out-Null
  Invoke-Json -Method "POST" -Path "/parent/task-session-reminders/$($childReminder.id)/read" -Headers $parentHeaders | Out-Null

  $stats = Invoke-Json -Method "GET" -Path "/parent/stats" -Headers $parentHeaders
  Assert-True (@($stats.dimensionScores).Count -ge 5) "parent stats should return growth dimension scores"
  Assert-True ([bool]$stats.recommendations) "parent stats should return recommendations"
  Assert-True ($stats.wellbeing.autoCompletedCount -ge 1) "parent stats should include auto-completed task signals"

  $insights = Invoke-Json -Method "GET" -Path "/parent/growth-insights?days=14" -Headers $parentHeaders
  Assert-True ([bool]$insights.recommendations) "growth insights should return recommendations"
  Invoke-Json -Method "GET" -Path "/parent/reward-pools" -Headers $parentHeaders | Out-Null
  Invoke-Json -Method "GET" -Path "/child/chest-prizes" -Headers $childHeaders | Out-Null

  Write-Host "[OK] Smoke test passed on $baseUrl" -ForegroundColor Green
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    try {
      Wait-Process -Id $server.Id -Timeout 5 -ErrorAction SilentlyContinue
    } catch {}
    Start-Sleep -Milliseconds 500
  }

  $env:PORT = $oldPort
  $env:NODE_ENV = $oldNodeEnv
  $env:JWT_SECRET = $oldSecret
  $env:STARCOIN_DB_PATH = $oldDbPath
  $env:ENABLE_DB_BACKUP = $oldBackup

  foreach ($file in @($dbPath, "$dbPath-shm", "$dbPath-wal")) {
    if (Test-Path -LiteralPath $file) {
      try {
        Remove-Item -LiteralPath $file -Force -ErrorAction Stop
      } catch {
        Write-Warning "Could not remove temporary file: $file"
      }
    }
  }
}
