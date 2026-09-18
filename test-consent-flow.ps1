# test-consent-flow.ps1
# Script to test the full Consent Enforcement module flow

$baseUrl = "http://localhost:3000/consent"
$patientId = "550e8400-e29b-41d4-a716-446655440000"

# 1. Save Consent Preferences
Write-Host "`n--- Step 1: Saving Patient Consent Preferences ---" -ForegroundColor Cyan
$saveBody = @{
    patient_id = $patientId
    preferences = @{
        allowed_channels = @{ sms = $true; whatsapp = $true; email = $false; call = $false }
        allowed_message_types = @("alert", "reminder")
        quiet_hours = @{ start_time = "22:00"; end_time = "07:00" }
    }
} | ConvertTo-Json -Depth 5

$saveResponse = Invoke-RestMethod -Uri "$baseUrl/consent" -Method Post -ContentType "application/json" -Body $saveBody
Write-Host "Response: $($saveResponse | ConvertTo-Json)"

# 2. Check Consent (Valid Day Visit)
Write-Host "`n--- Step 2: Checking Consent (Daytime Alert - Should be ALLOWED) ---" -ForegroundColor Cyan
$checkBody1 = @{
    patient_id = $patientId
    communication_channel = "whatsapp"
    message_type = "alert"
    urgency_level = "low"
    timestamp = "2026-04-06T14:00:00Z"
} | ConvertTo-Json

$res1 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $checkBody1
$res1 | ConvertTo-Json

# 3. Check Consent (Quiet Hours - Should be DENIED)
Write-Host "`n--- Step 3: Checking Consent (Quiet Hours Visit - Should be DENIED) ---" -ForegroundColor Cyan
$checkBody2 = @{
    patient_id = $patientId
    communication_channel = "whatsapp"
    message_type = "alert"
    urgency_level = "medium"
    timestamp = "2026-04-06T23:00:00Z"
} | ConvertTo-Json

$res2 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $checkBody2
$res2 | ConvertTo-Json

# 4. Check Consent (Emergency Override - Should be ALLOWED)
Write-Host "`n--- Step 4: Checking Consent (Emergency Override - Should be ALLOWED) ---" -ForegroundColor Cyan
$checkBody3 = @{
    patient_id = $patientId
    communication_channel = "whatsapp"
    message_type = "alert"
    urgency_level = "critical"
    timestamp = "2026-04-06T23:00:00Z"
} | ConvertTo-Json

$res3 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $checkBody3
$res3 | ConvertTo-Json

# 5. Check Consent (Disabled Channel - Should be DENIED)
Write-Host "`n--- Step 5: Checking Consent (Email - Should be DENIED) ---" -ForegroundColor Cyan
$checkBody4 = @{
    patient_id = $patientId
    communication_channel = "email"
    message_type = "alert"
    urgency_level = "critical"
    timestamp = "2026-04-06T14:00:00Z"
} | ConvertTo-Json

$res4 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $checkBody4
$res4 | ConvertTo-Json
