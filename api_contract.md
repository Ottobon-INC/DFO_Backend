--- GENERATE TOKEN ---
URL: https://dev.abdm.gov.in/api/hiecm/v3/token/generate-token
METHOD: POST
HEADERS:
REQUEST-ID: {{$guid}}
TIMESTAMP: {{$isoTimestamp}}
X-HIP-ID: {{X-HIP-ID}}
X-CM-ID: {{X-CM-ID}}
BODY:
{
    "abhaNumber": {{ABHA Number}},
    "abhaAddress": "{{ABHA Address}}",
    "name": "{{name}}",
    "gender": "{{gender}}",
    "yearOfBirth": {{year}}
}
RESPONSE STATUS: Accepted 202
RESPONSE BODY:
Note: this response is expected on Webhook url. 
https://webhook.site/61350a6f-2a80-4dc0-9f87-80649933e989/api/v3/hip/token/on-generate-token

{
  "abhaAddress": "abdulkalam.vthree@sbx",
  "linkToken": "eyJhbGciOiJSUzUxMiJ9.eyJoaXBJZCI6IlNCWF9ISVBfVjIiLCJzdWIiOiJuaXJzaGFkLnZ0aHJlZUBzYngiLCJhYmhhTnVtYmVyIjo5MTUzNjc4MjM2MTg2MiwiZXhwIjoxNzMxMDE0NjQ5LCJpYXQiOjE3MTUyNDY2NDksInRyYW5zYWN0aW9uSWQiOiIxZWNkYjg5Yy05ZGMxLTQwZDEtOTg2Yy0xN2YzYTQxM2NmZDAiLCJhYmhhQWRkcmVzcyI6Im5pcnNoYWQudnRocmVlQHNieCJ9.IG1exoiGJirKiohjltXSeuAIG1y70quMJofgX1C4MDaYdNfADj1IrE1t24cmAKB2c72jEsI4DBhVColzpCnqflMUPnQ3EL6X76pmSa_A2uOu_ffrlIkbetSqw03VLBlVY6b6dCv9qGC_iV8jah8cBlPKBeVIVNQCW-UL2RTBj2IEK3r814vX4cMjaIFV_ry_FRweGcYC38mKQMvqW6uATQnytFDgYicok3uY-lDLgBYk7Ux4KtlRw5RhYactqXv0OJDEPLbnFmLmhYRtXW5xZp-P_e9YvodCIwob5kdGDNJJAg5vNc9lnm3R5343OfJaOaRtotXq4AV_EEdxG1FWag",
  "response": {
    "requestId": "7c9962d4-b259-42b5-8aba-342bea26fbb4"
  }
}

--- ON GENERATE TOKEN ---
Not found
