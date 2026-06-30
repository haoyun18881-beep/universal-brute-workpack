param(
  [switch]$SkipUsageCheck
)

$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)][securestring]$SecureValue)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

Write-Host "Paste Tavily API key. Input is hidden." -ForegroundColor Cyan
$secure = Read-Host "TAVILY_API_KEY" -AsSecureString
$key = (ConvertFrom-SecureStringToPlainText -SecureValue $secure).Trim()

if ([string]::IsNullOrWhiteSpace($key)) {
  throw "TAVILY_API_KEY is empty."
}

[Environment]::SetEnvironmentVariable('TAVILY_API_KEY', $key, 'User')
[Environment]::SetEnvironmentVariable('TAVILY_API_KEY', $key, 'Process')
[Environment]::SetEnvironmentVariable('TAVILY_API_KEYS', $null, 'User')
[Environment]::SetEnvironmentVariable('TAVILY_API_KEYS', $null, 'Process')

Write-Host "TAVILY_API_KEY saved to Windows User environment and current PowerShell process." -ForegroundColor Green
Write-Host "The key value was not printed." -ForegroundColor DarkGray

if ($SkipUsageCheck) {
  Write-Host "Skipped Tavily usage check." -ForegroundColor Yellow
  return
}

$headers = @{
  Authorization = "Bearer $key"
}

try {
  $usage = Invoke-RestMethod -Method Get -Uri 'https://api.tavily.com/usage' -Headers $headers -TimeoutSec 20
  $summary = [ordered]@{
    ok = $true
    endpoint = 'usage'
    current_plan = $usage.account.current_plan
    plan_usage = $usage.account.plan_usage
    plan_limit = $usage.account.plan_limit
    search_usage = $usage.account.search_usage
    key_usage = $usage.key.usage
    key_limit = $usage.key.limit
  }
  $summary | ConvertTo-Json -Depth 5
} catch {
  $status = $null
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $status = [int]$_.Exception.Response.StatusCode
  }
  [ordered]@{
    ok = $false
    endpoint = 'usage'
    status = $status
    message = $_.Exception.Message
  } | ConvertTo-Json -Depth 5
}

Write-Host "Restart Codex Desktop or open a new Codex session for MCP servers to inherit the updated User environment." -ForegroundColor Yellow
