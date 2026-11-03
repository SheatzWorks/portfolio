# DATA PROCESSING AGREEMENT (DPA)

**Version:** 1.0 (DRAFT — FOR LEGAL REVIEW)
**Date:** [DATE]

**PARTIES:**

**Controller:**  
**[STUDIO LEGAL NAME]** ("Controller")  
[Address]  
[Jurisdiction] [Entity Type]  
Contact: [DPO/Privacy Contact Email]

**Processor:**  
**[PROCESSOR LEGAL NAME]** ("Processor")  
[Address]  
[Jurisdiction] [Entity Type]  
Contact: [Privacy Contact Email]

(Each a "Party"; collectively the "Parties")

---

## 1. DEFINITIONS

Terms defined in GDPR Article 4 / DPDP Act Section 2 apply. Key terms:

| Term | Definition |
|------|------------|
| **"Personal Data"** | Any information relating to an identified or identifiable natural person |
| **"Processing"** | Any operation on Personal Data (collection, storage, use, disclosure, deletion, etc.) |
| **"Data Subject"** | The individual to whom Personal Data relates |
| **"Supervisory Authority"** | GDPR: EU SA / UK: ICO / India: Data Protection Board |
| **"Subprocessor"** | Third party engaged by Processor to Process Personal Data on Controller's behalf |

---

## 2. SCOPE & NATURE OF PROCESSING

### 2.1 Categories of Personal Data

| Category | Details |
|----------|---------|
| **Contact/Identity** | Name, email, company, job title |
| **Contact Details** | Email, phone, address |
| **Business Information** | Company, role, project type, budget, timeline |
| **Technical Data** | IP address (hashed), user agent, referrer, timestamps |
| **Communication Content** | Messages, enquiries, correspondence |
| **Authentication Data** | Hashed tokens, session identifiers |

### 2.2 Categories of Data Subjects
- Website visitors / contact form submitters
- Studio admin users
- Client project stakeholders

### 2.3 Purposes of Processing
1. **Contact Form Handling** — Receive, store, forward enquiries; respond to data subjects
2. **Admin Authentication** — Secure access to Studio's admin panel
3. **Rate Limiting & Security** — Prevent abuse, spam, brute-force attacks
4. **Analytics/Monitoring** — Service health, performance, security (no profiling)
5. **Email Delivery** — Transactional emails (enquiry confirmations, notifications)
6. **Compliance/Legal** — Respond to legal requests, exercise data subject rights

### 2.4 Duration
Processing continues for the term of the underlying service agreement, plus retention periods per Schedule 1.

---

## 3. PROCESSOR OBLIGATIONS

### 3.1 General
Processor shall:
- Process Personal Data **only on Controller's documented instructions** (this DPA + written supplements)
- Ensure all personnel with access are **bound by confidentiality**
- Implement **appropriate technical and organisational measures** (Schedule 2)
- **Not engage Subprocessors** without Controller's prior written authorisation (Section 5)
- **Notify Controller** immediately if instructions violate applicable law
- **Delete or return** all Personal Data at Controller's choice on termination (Section 8)

### 3.2 No Independent Processing
Processor shall not Process Personal Data for its own purposes or any third party's purposes.

### 3.3 Data Subject Rights Assistance
Processor shall assist Controller in fulfilling data subject requests (access, rectification, erasure, restriction, portability, objection) within **[5 BUSINESS DAYS]** of Controller's request.

### 3.4 Breach Notification
Processor shall notify Controller **without undue delay, and in any event within 24 HOURS** of becoming aware of a Personal Data breach, including:
- Nature of breach
- Categories/approximate number of data subjects/records affected
- Likely consequences
- Measures taken/proposed to mitigate

### 3.5 Records of Processing
Processor shall maintain records of Processing activities per GDPR Article 30 / DPDP requirements, available to Controller on request.

### 3.6 Data Protection Impact Assessment (DPIA)
Processor shall assist Controller with DPIAs where required, providing necessary information.

### 3.7 Audit Rights
Controller may audit Processor's compliance (or appoint third-party auditor) on **[30 DAYS']** written notice, during business hours, with minimal disruption. Processor cooperates fully.

---

## 4. SECURITY MEASURES (Schedule 2)

Processor implements at minimum:

| Measure | Implementation |
|---------|----------------|
| **Encryption at Rest** | AES-256 (or equivalent) for all stored Personal Data |
| **Encryption in Transit** | TLS 1.2+ for all data in transit |
| **Access Control** | Role-based access; least privilege; MFA for admin access |
| **Authentication** | MFA for all personnel accessing Personal Data |
| **Logging & Monitoring** | Access logs retained 90 days; alerting on anomalous access |
| **Vulnerability Management** | Regular scanning; patching within [30/14/7] days by severity |
| **Incident Response** | Documented plan; tested annually |
| **Personnel Training** | Annual privacy/security training for all personnel |
| **Backup & Recovery** | Encrypted backups; tested recovery [quarterly] |
| **Physical Security** | Data centres: ISO 27001 / SOC 2 certified |

---

## 5. SUBPROCESSORS

### 5.1 General Authorisation
Controller **generally authorises** the Subprocessors listed in **Schedule 3**.

### 5.2 New Subprocessors
Processor shall:
1. Notify Controller of any new Subprocessor **at least 14 DAYS** before engagement
2. Provide: Subprocessor name, location, processing activities, security measures
3. Allow Controller **10 BUSINESS DAYS** to object (with reasonable grounds)
4. If Controller objects, Processor shall not engage or shall provide alternative

### 5.3 Subprocessor Obligations
Processor ensures each Subprocessor is bound by written agreement with obligations **no less protective** than this DPA. Processor remains fully liable for Subprocessor acts/omissions.

### 5.4 Subprocessor List
See **Schedule 3**.

---

## 6. INTERNATIONAL DATA TRANSFERS

### 6.1 Transfer Mechanism
Where Personal Data is transferred outside [EEA/UK/India], Processor ensures:
- **Adequacy decision** applies; OR
- **Standard Contractual Clauses (SCCs)** (Controller-to-Processor) are in place; OR
- **Binding Corporate Rules (BCRs)**; OR
- **Other approved mechanism** per applicable law

### 6.2 Current Transfers
| Transfer | Destination | Mechanism | Status |
|----------|-------------|-----------|--------|
| [Processor] → [Subprocessor] | [Country] | [SCC/BCR/Adequacy] | [Implemented/Pending] |

### 6.3 Transfer Impact Assessment
Processor shall assist Controller with Transfer Impact Assessments where required.

---

## 7. DATA SUBJECT RIGHTS

Processor shall assist Controller in responding to:

| Right | Processor Assistance |
|-------|---------------------|
| **Access** | Provide copy of Personal Data in machine-readable format |
| **Rectification** | Correct inaccurate/incomplete data |
| **Erasure** | Delete Personal Data (where no legal retention obligation) |
| **Restriction** | Limit Processing (flag, suppress) |
| **Portability** | Provide data in structured, commonly used, machine-readable format |
| **Objection** | Cease Processing (where applicable) |
| **Automated Decisions** | Provide meaningful information about logic |

**Timeline:** Processor responds to Controller's request within **[5 BUSINESS DAYS]**.

---

## 8. TERMINATION & DATA RETURN/DELETION

### 8.1 Termination Events
This DPA terminates automatically upon termination of the underlying service agreement.

### 8.2 Data Return/Deletion
Within **30 DAYS** of termination, Processor shall (at Controller's written choice):
- **Return** all Personal Data in machine-readable format; OR
- **Securely delete** all Personal Data (including backups)

### 8.3 Certification
Processor provides written certification of deletion/return within **10 BUSINESS DAYS** of completion.

### 8.3 Exceptions
Processor may retain Personal Data only where required by applicable law, and only for the duration of that requirement. Processor shall:
- Isolate such data
- Process only for the legal obligation
- Delete immediately when obligation ends

---

## 8. LIABILITY & INDEMNIFICATION

### 8.1 Processor Liability
Processor liable for damages caused by breach of this DPA, subject to the liability cap in the underlying service agreement.

### 8.2 Indemnification
Processor indemnifies Controller for:
- Third-party claims arising from Processor's breach of this DPA
- Regulatory fines/penalties attributable to Processor's breach
- Reasonable costs of breach notification, remediation, legal defence

Controller indemnifies Processor for claims arising from Controller's instructions violating law.

---

## 9. GENERAL PROVISIONS

### 9.1 Governing Law
Laws of **[JURISDICTION]**.

### 9.2 Dispute Resolution
Per underlying service agreement.

### 9.3 Notices
Written, to addresses in preamble. Email valid.

### 9.3 Entire Agreement
This DPA + Schedules = entire agreement on data protection. Amendments in writing.

### 9.3 Severability / Waiver / Assignment
Standard clauses.

### 9.4 Survival
Sections 3, 4, 6, 7, 8, 9 survive termination.

---

## SIGNATURES

**CONTROLLER**

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

**PROCESSOR**

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

---

## SCHEDULE 1 — RETENTION SCHEDULE

| Personal Data Category | Retention Period | Deletion Method |
|------------------------|------------------|-----------------|
| Contact enquiries (answered) | 2 years from last contact | Automated deletion |
| Contact enquiries (unanswered) | 90 days | Automated deletion |
| Rate limit hashes | Rolling 1 hour | Automatic expiry |
| Admin sessions | 12 hours (cookie) | Automatic expiry |
| Server logs | Platform default (7-30 days) | Platform managed |
| Email delivery records | Platform default (30-90 days) | Platform managed |
| Backup data | Per backup retention policy | Automated deletion |

---

## SCHEDULE 2 — TECHNICAL & ORGANISATIONAL MEASURES

[Detail the measures from Section 4 with specific configurations, e.g.:
- Encryption: AES-256-GCM for D1/R2; TLS 1.3 for all endpoints
- Access: RBAC with least privilege; MFA enforced via Cloudflare Access
- Logging: Cloudflare Logpush to R2; 90-day retention; SIEM integration
- Vulnerability: Dependabot + npm audit weekly; SLA: Critical 7d, High 14d, Medium 30d
- Incident Response: Documented runbook; annual tabletop exercise
- Training: Annual privacy/security training; phishing simulations quarterly
- Backup: D1 point-in-time recovery; R2 versioning; quarterly restore test
- Certifications: Cloudflare SOC 2 Type II, ISO 27001; Resend SOC 2 Type II
]

---

## SCHEDULE 3 — AUTHORISED SUBPROCESSORS

| Subprocessor | Purpose | Location | Data Categories | SCCs in Place |
|--------------|---------|----------|-----------------|---------------|
| [e.g., Amazon Web Services] | Infrastructure hosting | [US/EU] | All (encrypted) | Yes (AWS DPA) |
| [e.g., Google Cloud Platform] | Infrastructure hosting | [US/EU] | All (encrypted) | Yes (GCP DPA) |
| [Resend] | Email delivery | US | Contact/enquiry data | Yes (Resend DPA) |
| [Cloudflare Turnstile] | Bot detection | Global | IP hash, token | Yes (Cloudflare DPA) |

---

*End of Data Processing Agreement Template*
*Version: 1.0 (DRAFT — REQUIRES LEGAL REVIEW)*
*Classification: CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED*