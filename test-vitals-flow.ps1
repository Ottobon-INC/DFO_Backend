# test-vitals-flow.ps1
# Script to test the Vitals Service and Trend Analysis flow

$baseUrl = "http://localhost:3000/vitals"
$patientId = "550e8400-e29b-41d4-a716-446655440000"

# 1. Normal Heart Rate (Should just record)
Write-Host "`n--- Step 1: Recording Normal Heart Rate ---" -ForegroundColor Cyan
$normalBody = @{
    patient_id = $patientId
    vital_type = "heart_rate"
    value = 85
} | ConvertTo-Json

$res1 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $normalBody
$res1 | ConvertTo-Json

# 2. Critical Threshold (Fever)
Write-Host "`n--- Step 2: Recording Critical Temperature (Should TRIGGER high_risk & Alert) ---" -ForegroundColor Cyan
$feverBody = @{
    patient_id = $patientId
    vital_type = "temperature"
    value = 39.5
} | ConvertTo-Json

$res2 = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $feverBody
$res2 | ConvertTo-Json

# 3. Simulate Trend (Increasing BP over 3 records)
Write-Host "`n--- Step 3: Triggering BP Trend (Three Consecutive Rising Readings) ---" -ForegroundColor Cyan

# Reading 1
$bp1 = @{ patient_id = $patientId; vital_type = "blood_pressure"; value = "110/80"; recorded_at = "2026-04-06T09:00:00Z" } | ConvertTo-Json
Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $bp1 | Out-Null
Write-Host "Recorded BP 110/80"

# Reading 2
$bp2 = @{ patient_id = $patientId; vital_type = "blood_pressure"; value = "115/80"; recorded_at = "2026-04-06T10:00:00Z" } | ConvertTo-Json
Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $bp2 | Out-Null
Write-Host "Recorded BP 115/80"

# Reading 3 (This one should trigger the trend warning!)
$bp3 = @{ patient_id = $patientId; vital_type = "blood_pressure"; value = "125/80"; recorded_at = "2026-04-06T11:00:00Z" } | ConvertTo-Json
$resTrend = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $bp3
Write-Host "Recorded BP 125/80"
$resTrend | ConvertTo-Json

# 4. Fetch the patient's vitals history
Write-Host "`n--- Step 4: Fetching Vitals History ---" -ForegroundColor Cyan
$resHistory = Invoke-RestMethod -Uri "$baseUrl/$patientId" -Method Get
Write-Host "Found $($resHistory.data.Length) total vital records!"
$resHistory.data | Select-Object vital_type, value, recorded_at | Format-Table
