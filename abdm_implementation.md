# ABDM M1 Implementation Documentation

## 1. Implemented M1 APIs

### API: Generate Session (API #1)
- **DFO controller route:** `POST /api/v1/abdm/test-session`
- **Controller method:** `testSession`
- **Service method:** `generateSession`
- **ABDM endpoint:** `app.abdm.sessionUrl` (from config)
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `X-CM-ID`, `Content-Type`
- **How the session/access token is obtained:** N/A (This is the method that generates it)
- **Whether X-token is used:** No
- **Request body fields:** `clientId`, `clientSecret`, `grantType` ('client_credentials')
- **Encryption/decryption used:** None
- **ABDM response fields used:** `accessToken`, `tokenType`, `expiresIn`
- **Database tables read:** None
- **Database tables written/updated:** None
- **Error handling:** Catches axios errors, redacts `clientSecret` from logs, returns `502 BAD_GATEWAY`, `504 GATEWAY_TIMEOUT`, or `500 INTERNAL_SERVER_ERROR`.
- **Environment variables/configuration used:** `app.abdm.clientId`, `app.abdm.clientSecret`, `app.abdm.xCmId`, `app.abdm.sessionUrl`
- **Next API/workflow step:** Used internally by almost all other APIs.
- **Any callbacks involved:** None

### API: Get Public Certificate
- **DFO controller route:** `GET /api/v1/abdm/test-encryption`
- **Controller method:** `testEncryption`
- **Service method:** `getPublicCertificate`
- **ABDM endpoint:** `app.abdm.publicCertUrl`
- **HTTP method:** `GET`
- **Request headers:** `Authorization`, `REQUEST-ID`, `TIMESTAMP`, `Content-Type`
- **How the session/access token is obtained:** Calls `generateSession()` if not provided as argument.
- **Whether X-token is used:** No
- **Request body fields:** None
- **Encryption/decryption used:** None
- **ABDM response fields used:** `publicKey`, `encryptionAlgorithm`
- **Database tables read:** None
- **Database tables written/updated:** None
- **Error handling:** Standard axios error catch mapping to 502/504/500 HttpExceptions.
- **Environment variables/configuration used:** `app.abdm.publicCertUrl`
- **Next API/workflow step:** Used internally for encryption before OTP/Auth requests.
- **Any callbacks involved:** None

### API: Request OTP for ABHA Creation (Aadhaar) (API #3)
- **DFO controller route:** `POST /api/v1/abdm/test-aadhaar-otp`
- **Controller method:** `testAadhaarOtp`
- **Service method:** `requestAadhaarOtp`
- **ABDM endpoint:** `app.abdm.aadhaarOtpUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `txnId` (empty string), `scope` (['abha-enrol']), `loginHint` ('aadhaar'), `loginId` (encrypted Aadhaar), `otpSystem` ('aadhaar')
- **Encryption/decryption used:** Aadhaar number is encrypted using `encryptData` with ABDM Public Key.
- **ABDM response fields used:** `txnId`, `message`
- **Database tables read:** None
- **Database tables written/updated:** None
- **Error handling:** Redacts `loginId` from error logs, standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.aadhaarOtpUrl`
- **Next API/workflow step:** Verify OTP for ABHA Creation
- **Any callbacks involved:** None

### API: Verify OTP for ABHA Creation (Aadhaar) (API #4)
- **DFO controller route:** `POST /api/v1/abdm/enrol-aadhaar-otp`
- **Controller method:** `enrolAadhaarOtp`
- **Service method:** `enrolAbhaViaAadhaarOtp`
- **ABDM endpoint:** `app.abdm.enrolByAadhaarUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `authData` (authMethods: ['otp'], otp: { txnId, otpValue (encrypted), mobile }), `consent` (code: 'abha-enrollment', version: '1.4')
- **Encryption/decryption used:** OTP is encrypted using `encryptData` with ABDM Public Key.
- **ABDM response fields used:** `ABHAProfile.ABHANumber` (or `abhaNumber`), `ABHAProfile.phrAddress`, `isNew`, `message`
- **Database tables read:** `sakhi_clinic_patients`, `patient_abha`
- **Database tables written/updated:** `patient_abha` (inserted or updated)
- **Error handling:** Checks for identity/number/address conflicts (409), standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.enrolByAadhaarUrl`
- **Next API/workflow step:** None (ABHA created and linked)
- **Any callbacks involved:** None

### API: Get ABHA Address Suggestions (API #7)
- **DFO controller route:** `GET /api/v1/abdm/enrol-abha-address-suggestions`
- **Controller method:** `getAbhaAddressSuggestions`
- **Service method:** `getAbhaAddressSuggestions`
- **ABDM endpoint:** `app.abdm.abhaAddressSuggestionUrl`
- **HTTP method:** `GET`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Transaction_Id`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** None
- **Encryption/decryption used:** None
- **ABDM response fields used:** Entire response array (suggestions)
- **Database tables read:** `sakhi_clinic_patients`, `patient_abha`
- **Database tables written/updated:** None
- **Error handling:** Standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressSuggestionUrl`
- **Next API/workflow step:** Create ABHA Address
- **Any callbacks involved:** None

### API: Create ABHA Address (API #7)
- **DFO controller route:** `POST /api/v1/abdm/enrol-abha-address`
- **Controller method:** `enrolAbhaAddress`
- **Service method:** `createAbhaAddress`
- **ABDM endpoint:** `app.abdm.abhaAddressCreateUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `txnId`, `abhaAddress`, `preferred` (1)
- **Encryption/decryption used:** None
- **ABDM response fields used:** `preferredAbhaAddress`, `healthIdNumber`
- **Database tables read:** `sakhi_clinic_patients`, `patient_abha`
- **Database tables written/updated:** `patient_abha` (updated)
- **Error handling:** Checks for identity conflicts (409), standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressCreateUrl`
- **Next API/workflow step:** None
- **Any callbacks involved:** None

### API: Search Auth Methods (Mobile) (API #8)
- **DFO controller route:** `POST /api/v1/abdm/search-auth-methods`
- **Controller method:** `searchAuthMethods`
- **Service method:** `searchAuthMethods`
- **ABDM endpoint:** `app.abdm.abhaAddressSearchUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `abhaAddress`
- **Encryption/decryption used:** None
- **ABDM response fields used:** Entire response data
- **Database tables read:** `sakhi_clinic_patients`
- **Database tables written/updated:** None
- **Error handling:** Standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressSearchUrl`
- **Next API/workflow step:** Request Mobile OTP
- **Any callbacks involved:** None

### API: Request Mobile OTP (API #11)
- **DFO controller route:** `POST /api/v1/abdm/request-mobile-otp`
- **Controller method:** `requestMobileOtp`
- **Service method:** `requestMobileOtp`
- **ABDM endpoint:** `app.abdm.abhaAddressRequestOtpUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `scope` (['abha-address-login', 'mobile-verify']), `loginHint` ('abha-address'), `loginId` (encrypted ABHA Address), `otpSystem` ('abdm')
- **Encryption/decryption used:** ABHA Address is encrypted using `encryptData` with ABDM Public Key.
- **ABDM response fields used:** `txnId`, `message`
- **Database tables read:** `sakhi_clinic_patients`
- **Database tables written/updated:** None
- **Error handling:** Standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressRequestOtpUrl`
- **Next API/workflow step:** Verify Mobile OTP
- **Any callbacks involved:** None

### API: Verify Mobile OTP (API #12)
- **DFO controller route:** `POST /api/v1/abdm/verify-mobile-otp`
- **Controller method:** `verifyMobileOtp`
- **Service method:** `verifyMobileOtp`
- **ABDM endpoint:** `app.abdm.abhaAddressVerifyOtpUrl` (and `app.abdm.abhaProfileUrl`)
- **HTTP method:** `POST` (and `GET` for profile)
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type` (and `X-token` for profile)
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** Yes, obtained from verify OTP response and used in profile fetch request.
- **Request body fields:** `scope` (['abha-address-login', 'mobile-verify']), `authData` (authMethods: ['otp'], otp: { txnId, otpValue (encrypted) })
- **Encryption/decryption used:** OTP is encrypted using `encryptData` with ABDM Public Key.
- **ABDM response fields used:** `tokens.token` (X-token), `abhaAddress`, `abhaNumber` (from profile)
- **Database tables read:** `sakhi_clinic_patients`, `patient_abha`
- **Database tables written/updated:** `patient_abha` (inserted or updated)
- **Error handling:** Checks for identity/address conflicts (409), standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressVerifyOtpUrl`, `app.abdm.abhaProfileUrl`
- **Next API/workflow step:** None (ABHA verified and linked)
- **Any callbacks involved:** None

### API: Search Auth Methods (Aadhaar) (API #8)
- **DFO controller route:** `POST /api/v1/abdm/verification/aadhaar/search`
- **Controller method:** `searchAuthMethodsAadhaar`
- **Service method:** `searchAuthMethodsAadhaar`
- **ABDM endpoint:** `app.abdm.abhaAddressSearchUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `abhaAddress`
- **Encryption/decryption used:** None
- **ABDM response fields used:** Entire response data
- **Database tables read:** `sakhi_clinic_patients`
- **Database tables written/updated:** None
- **Error handling:** Standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressSearchUrl`
- **Next API/workflow step:** Request Aadhaar OTP
- **Any callbacks involved:** None

### API: Request Aadhaar OTP (API #9)
- **DFO controller route:** `POST /api/v1/abdm/verification/aadhaar/request-otp`
- **Controller method:** `requestAadhaarOtpForVerification`
- **Service method:** `requestAadhaarOtpForVerification`
- **ABDM endpoint:** `app.abdm.abhaAddressRequestOtpUrl`
- **HTTP method:** `POST`
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type`
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** No
- **Request body fields:** `scope` (['abha-address-login', 'aadhaar-verify']), `loginHint` ('abha-address'), `loginId` (encrypted ABHA Address), `otpSystem` ('aadhaar')
- **Encryption/decryption used:** ABHA Address is encrypted using `encryptData` with ABDM Public Key.
- **ABDM response fields used:** `txnId`, `message`
- **Database tables read:** `sakhi_clinic_patients`
- **Database tables written/updated:** None
- **Error handling:** Standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressRequestOtpUrl`
- **Next API/workflow step:** Verify Aadhaar OTP
- **Any callbacks involved:** None

### API: Verify Aadhaar OTP (API #10)
- **DFO controller route:** `POST /api/v1/abdm/verification/aadhaar/verify-otp`
- **Controller method:** `verifyAadhaarOtpForVerification`
- **Service method:** `verifyAadhaarOtpForVerification`
- **ABDM endpoint:** `app.abdm.abhaAddressVerifyOtpUrl` (and `app.abdm.abhaProfileUrl`)
- **HTTP method:** `POST` (and `GET` for profile)
- **Request headers:** `REQUEST-ID`, `TIMESTAMP`, `Authorization`, `Content-Type` (and `X-token` for profile)
- **How the session/access token is obtained:** `await this.generateSession()`
- **Whether X-token is used:** Yes, obtained from verify OTP response and used in profile fetch request.
- **Request body fields:** `scope` (['abha-address-login', 'aadhaar-verify']), `authData` (authMethods: ['otp'], otp: { txnId, otpValue (encrypted) })
- **Encryption/decryption used:** OTP is encrypted using `encryptData` with ABDM Public Key.
- **ABDM response fields used:** `tokens.token` (X-token), `abhaAddress`, `abhaNumber` (from profile)
- **Database tables read:** `sakhi_clinic_patients`, `patient_abha`
- **Database tables written/updated:** `patient_abha` (inserted or updated)
- **Error handling:** Checks for identity/address conflicts (409), standard axios error catch.
- **Environment variables/configuration used:** `app.abdm.abhaAddressVerifyOtpUrl`, `app.abdm.abhaProfileUrl`
- **Next API/workflow step:** None (ABHA verified and linked)
- **Any callbacks involved:** None

## 2. Separate Documentation

### ABDM Session Generation Implementation
Implemented in `AbdmService.generateSession()`. It sends a POST request to `app.abdm.sessionUrl` with `clientId`, `clientSecret`, and `grantType: 'client_credentials'`. It returns the `accessToken` which is used for subsequent API calls.

### Access-token Lifecycle
The access token is generated on-the-fly for almost every service method by calling `await this.generateSession()`. It is not cached or stored in the database in the current implementation. It is passed in the `Authorization: Bearer <token>` header for ABDM requests.

### X-token Lifecycle
The `X-token` is obtained from the response of the Verify OTP endpoints (`verifyMobileOtp` and `verifyAadhaarOtpForVerification`). It is immediately used in the subsequent `GET` request to fetch the user's profile (`abhaProfileUrl`). It is not stored or persisted.

### REQUEST-ID
Generated dynamically using `uuidv4()` for every single request made to ABDM.

### TIMESTAMP
Generated dynamically using `new Date().toISOString()` for every single request made to ABDM.

### Encryption Implementation
Implemented in `AbdmService.encryptData()`. It uses Node.js `crypto.publicEncrypt` with `RSA_PKCS1_OAEP_PADDING` and `sha1` hash. The public key is fetched dynamically via `getPublicCertificate()`. The function ensures the public key has proper PEM headers (`-----BEGIN PUBLIC KEY-----`) before encrypting.

### Patient/ABHA Database Mapping
- **`sakhi_clinic_patients`**: Read to verify patient existence and retrieve `clinic_id`.
- **`patient_abha`**: Read to check for existing active ABHA records (`is_active = true`). Written/updated to store `abha_number`, `abha_address`, and `verification_status: 'VERIFIED'`. Conflict checks are performed to ensure no two patients in the same clinic share the same ABHA number or address.

### Authentication Flow
The DFO endpoints are currently mostly unprotected (guards are commented out for local development testing). The backend authenticates with ABDM using the `clientId` and `clientSecret` to get a Gateway token (`accessToken`), and authenticates the user using OTPs to get a User token (`X-token`).

### Error Handling Architecture
All ABDM service methods use a `try...catch` block. Axios errors are caught and transformed into NestJS `HttpException`s. 
- `error.response` results in `502 BAD_GATEWAY` with the ABDM error details.
- `error.request` results in `504 GATEWAY_TIMEOUT`.
- Other errors result in `500 INTERNAL_SERVER_ERROR`.
Sensitive data like `clientSecret` and `loginId` are explicitly redacted from error logs.
Database conflicts (e.g., ABHA already linked) throw `409 CONFLICT`.

### ABDM Module/Controller/Service Structure
- **Controller (`AbdmController`)**: Defines the REST endpoints, performs basic input validation (checking if required fields exist), and delegates to the service.
- **Service (`AbdmService`)**: Contains all business logic, ABDM API communication, encryption, and database interactions (using Supabase).
