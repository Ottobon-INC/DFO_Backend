# test-clinical-intelligence.ps1
# Script to test the Clinical Intelligence API from PowerShell

$baseUrl = "http://localhost:3000/analyze-conversation"

function Test-Clinical($name, $text) {
    Write-Host "`n--- Testing Scenario: $name ---" -ForegroundColor Cyan
    $body = @{ conversation = $text } | ConvertTo-Json
    try {
        $response = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $body
        $response | ConvertTo-Json -Depth 5
    } catch {
        Write-Error "Request failed: $_"
    }
}

# 1. Routine Query
Test-Clinical "Routine Query" "I have a slight headache and feel a bit tired. Is this normal?"

# 2. Medium Urgency
Test-Clinical "Medium Urgency" "I have had a mild fever for the last two days and some nausea."

# 3. Emergency Query
Test-Clinical "Emergency Query" "I am experiencing severe abdominal pain and heavy bleeding. Please help!"

# 4. No Symptoms
Test-Clinical "No Symptoms" "How should I prepare for my next appointment?"
