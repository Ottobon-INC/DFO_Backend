# test-alerting.ps1
# Script to test the Emergency Alert System flow

$baseUrl = "http://localhost:3000/trigger-alert"
$patientId = "550e8400-e29b-41d4-a716-446655440000"

# 1. Normal Case (Should NOT trigger)
Write-Host "`n--- Step 1: Testing Routine Case (Should NOT trigger alert) ---" -ForegroundColor Cyan
$routineBody = @{
    patient_id = $patientId
    symptoms = @("headache", "fatigue")
    risk_flags = @()
    urgency_level = "low"
} | ConvertTo-Json

$res1 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $routineBody
$res1 | ConvertTo-Json

# 2. Critical Case by Urgency (Should Trigger)
Write-Host "`n--- Step 2: Testing Critical Urgency (Should TRIGGER alert) ---" -ForegroundColor Cyan
$criticalBody = @{
    patient_id = $patientId
    symptoms = @("severe abdominal pain")
    risk_flags = @("High Pain Index")
    urgency_level = "critical"
} | ConvertTo-Json

$res2 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $criticalBody
$res2 | ConvertTo-Json

# 3. Critical Case by Dangerous Flags (Should Trigger)
Write-Host "`n--- Step 3: Testing Dangerous Risk Flags (Should TRIGGER alert) ---" -ForegroundColor Cyan
$flagBody = @{
    patient_id = $patientId
    symptoms = @("feeling dizzy")
    risk_flags = @("Possible Hemorrhage")
    urgency_level = "medium"
} | ConvertTo-Json

$res3 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $flagBody
$res3 | ConvertTo-Json
