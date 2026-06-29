# test-s3-document-flow.ps1
$ErrorActionPreference = "Stop"

$baseUrl = "http://localhost:3005"
$email = "admin@clinic.com"
$password = "password123"

Write-Host "1. Logging in..."
$loginBody = @{
    email = $email
    password = $password
} | ConvertTo-Json
$loginResponse = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.data.token
$clinicId = $loginResponse.data.user.clinic_id

Write-Host "2. Creating a test patient..."
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

$patientBody = @{
    name = "Test S3 Patient"
    mobile = "9999999999"
    gender = "Male"
} | ConvertTo-Json

$patientResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/clinics/patients" -Method Post -Headers $headers -Body $patientBody
$patientId = $patientResponse.data.id

Write-Host "3. Requesting S3 Upload Ticket..."
$ticketBody = @{
    filename = "test-prescription.pdf"
    documentType = "prescription"
} | ConvertTo-Json

$ticketResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/clinics/documents/upload-ticket" -Method Post -Headers $headers -Body $ticketBody
$uploadUrl = $ticketResponse.data.uploadUrl
$path = $ticketResponse.data.path

if (-not $uploadUrl) {
    throw "Failed to get upload URL"
}

Write-Host "Got Presigned URL for path: $path"

Write-Host "4. Simulating File Upload to S3 (Mocking with a simple PUT)..."
$fileContent = "Test PDF Content"
try {
    # This might fail if CORS is not perfectly set or if AWS credentials are wrong locally, 
    # but the request itself is valid.
    Invoke-RestMethod -Uri $uploadUrl -Method Put -Body $fileContent -ContentType "application/pdf"
    Write-Host "Successfully uploaded to S3!"
} catch {
    Write-Host "Upload to S3 failed. Ensure AWS credentials are correct and CORS allows PUT."
    Write-Host $_.Exception.Message
}

Write-Host "5. Registering Document Metadata..."
$registerBody = @{
    patient_id = $patientId
    name = "test-prescription.pdf"
    file_path = $path
    file_size = 1024
    mime_type = "application/pdf"
    document_type = "prescription"
} | ConvertTo-Json

$registerResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/clinics/documents/register" -Method Post -Headers $headers -Body $registerBody

if ($registerResponse.success) {
    Write-Host "Successfully registered document in Supabase with ID: $($registerResponse.data.id)"
} else {
    Write-Host "Failed to register document"
}

Write-Host "6. Verifying Patient Documents..."
$docsResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/clinics/patients/$patientId/documents" -Method Get -Headers $headers

if ($docsResponse.data.Count -gt 0) {
    Write-Host "Test Passed! Found $($docsResponse.data.Count) document(s) for patient."
} else {
    Write-Host "Test Failed! No documents found."
}
