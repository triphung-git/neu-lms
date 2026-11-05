$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectDir '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing root .env: $envPath" }
function Run-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with $LASTEXITCODE" }
}
Push-Location (Join-Path $projectDir 'backend')
try {
    Run-Checked uv @('sync', '--frozen', '--group', 'dev')
    Run-Checked uv @('run', 'ruff', 'check', '.')
    Run-Checked uv @('run', 'ruff', 'format', '--check', '.')
    Run-Checked uv @('run', '--env-file', $envPath, 'python', 'manage.py', 'check')
    Run-Checked uv @('run', '--env-file', $envPath, 'python', 'manage.py', 'makemigrations', '--check', '--dry-run')
    Run-Checked uv @('run', '--env-file', $envPath, 'python', '-m', 'pytest', '--ds=config.settings.test', '-q')
    Run-Checked uv @('run', '--env-file', $envPath, 'python', 'manage.py', 'spectacular', '--file', '../schema/openapi.json', '--validate', '--fail-on-warn', '--format', 'openapi-json')
} finally { Pop-Location }
Push-Location (Join-Path $projectDir 'frontend')
try {
    Run-Checked npm.cmd @('ci')
    Run-Checked npm.cmd @('run', 'api:check')
    Run-Checked npm.cmd @('run', 'lint')
    Run-Checked npm.cmd @('run', 'typecheck')
    Run-Checked npm.cmd @('test', '--', '--run')
    Run-Checked npm.cmd @('run', 'build')
} finally { Pop-Location }
Write-Host 'Release checks passed. External-provider UAT still required.'
