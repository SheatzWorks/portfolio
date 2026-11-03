# STATEMENT OF WORK TEMPLATE

**SoW Number:** [SOW-XXXX]
**Date:** [DATE]
**Master Services Agreement:** [MSA Reference/Date]
**Studio:** [Studio Legal Name]
**Client:** [Client Legal Name]

---

## 1. PROJECT OVERVIEW

| Field | Details |
|-------|---------|
| **Project Name** | [e.g., "Acme Corp — Customer Portal v2"] |
| **Project Type** | [Web Application / Mobile App / SaaS Platform / API / Integration / Other] |
| **Description** | [2-3 sentence summary of what is being built and why] |
| **Business Objective** | [What business problem does this solve? What does success look like?] |

---

## 2. SCOPE OF WORK

### 2.1 In-Scope Deliverables

| # | Deliverable | Description | Acceptance Criteria |
|---|-------------|-------------|---------------------|
| 1 | [e.g., Technical Specification] | [Detailed spec document with API contracts, data models, architecture diagrams] | [Client sign-off on PDF; all open questions resolved] |
| 2 | [e.g., Backend API] | [REST/GraphQL API with auth, rate limiting, docs] | [All endpoints return 200/400/401/404 correctly; Swagger/OpenAPI spec; 90%+ test coverage] |
| 3 | [e.g., Frontend Application] | [React/Next.js app with auth, dashboard, settings] | [Runs on staging; passes E2E tests; Lighthouse >90; WCAG 2.1 AA] |
| 4 | [e.g., Admin Dashboard] | [User management, analytics, content editing] | [CRUD operations work; role-based access; audit logs] |
| 5 | [e.g., Deployment & Documentation] | [CI/CD pipeline, runbooks, architecture decision records] | [Deploys to staging/prod; runbooks tested; ADRs complete] |

### 2.2 Out of Scope (Explicitly Excluded)

- [ ] Mobile app (separate SoW)
- [ ] Ongoing maintenance/support (separate Support Agreement)
- [ ] Third-party integrations not listed above
- [ ] Content creation/copywriting
- [ ] SEO/analytics implementation
- [ ] Load/penetration testing (unless specified)
- [ ] App Store / Play Store submission
- [ ] Third-party licence fees (Client responsible)
- [ ] Infrastructure costs beyond included hosting (Client responsible)

---

## 3. TIMELINE & MILESTONES

| Milestone | Deliverables | Target Date | Payment Trigger |
|-----------|--------------|-------------|-----------------|
| **M1: Kickoff & Discovery** | Project plan, tech stack decisions, risk register | [DATE] | 50% (on SoW execution) |
| **M2: Technical Specification** | Signed-off spec document | [DATE] | — |
| **M3: Backend Core** | Auth, database schema, core API endpoints | [DATE] | 25% |
| **M4: Frontend MVP** | Core user flows working on staging | [DATE] | — |
| **M5: Feature Complete** | All in-scope features demoable on staging | [DATE] | — |
| **M6: UAT & Bug Fix** | Client testing, bug fixes, performance tuning | [DATE] | — |
| **M7: Production Deploy** | Live on production, monitoring active | [DATE] | 25% (final) |
| **M8: Post-Launch Support** | 2 weeks hypercare, bug fixes | [DATE + 14 days] | — |

**Total Duration:** [X] weeks ([START DATE] to [END DATE])

---

## 4. TECHNICAL SPECIFICATIONS

### 4.1 Technology Stack (Agreed)

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | [Astro / Next.js / React / Vue] | [vX.Y] |
| Backend | [Node.js / Go / Python / Cloudflare Workers] | [vX.Y] |
| Database | [PostgreSQL / Cloudflare D1 / MongoDB] | [vX.Y] |
| Auth | [Custom / Auth0 / Clerk / Supabase] | — |
| Hosting | [Cloudflare Pages / Vercel / AWS / GCP] | — |
| CI/CD | [GitHub Actions / Cloudflare Pages] | — |
| Monitoring | [Sentry / LogRocket / Cloudflare Analytics] | — |

### 4.2 Architecture Decisions (Key)

| Decision | Rationale | ADR Reference |
|----------|-----------|---------------|
| [e.g., Serverless vs VM] | [Cost, scale, team expertise] | [ADR-001] |
| [e.g., Auth strategy] | [Security, UX, compliance] | [ADR-002] |
| [e.g., State management] | [Team familiarity, bundle size] | [ADR-003] |

### 4.3 Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Availability** | 99.9% monthly (excluding planned maintenance) |
| **Response Time (p95)** | < 200ms (API), < 3s (page load) |
| **Throughput** | [X] requests/second sustained |
| **Security** | OWASP Top 10 addressed; penetration test before launch |
| **Accessibility** | WCAG 2.1 AA |
| **Browser Support** | Last 2 versions of Chrome, Firefox, Safari, Edge |
| **Data Residency** | [EU / US / India / Global] |
| **Backup/RPO/RTO** | Daily backups / RPO 24h / RTO 4h |

---

## 5. ROLES & RESPONSIBILITIES

### 5.1 Studio Team

| Role | Name | Allocation | Responsibilities |
|------|------|------------|------------------|
| Principal Engineer | [Name] | [X]% | Architecture, code review, escalation |
| Senior Engineer | [Name] | [X]% | Backend/API development, code review |
| Engineer | [Name] | [X]% | Frontend/backend feature development |
| Designer | [Name] | [X]% | UI/UX, design system, prototypes |
| Project Manager | [Name] | [X]% | Planning, communication, risk management |

### 5.2 Client Responsibilities

| Responsibility | Details | Due Date |
|----------------|---------|----------|
| **Product Owner** | Single point of contact for decisions | [Name, email] |
| **Design Approval** | Sign off on designs/prototypes | [Date] |
| **Content/Assets** | Provide copy, images, logos, brand guidelines | [Date] |
| **API Credentials** | Provide third-party API keys, sandbox access | [Date] |
| **UAT Participation** | Dedicated tester(s) for 2-week UAT | [Names, dates] |
| **Stakeholder Sign-off** | Final acceptance at each milestone | [Names] |
| **Infrastructure Access** | Grant access to hosting, DNS, third-party services | [Date] |

---

## 6. FEES & PAYMENT

### 6.1 Total Fixed Fee: **[CURRENCY] [AMOUNT]**

### 6.2 Payment Schedule

| Milestone | Amount | Percentage | Due |
|-----------|--------|------------|-----|
| SoW Execution | [AMOUNT] | 50% | On signing |
| Milestone 3 (Backend Core) | [AMOUNT] | 25% | On M3 delivery |
| Milestone 7 (Production Deploy) | [AMOUNT] | 25% | On M7 delivery |

### 6.3 Additional Terms
- Invoices issued within 5 business days of trigger
- Payment terms: **Net 15** from invoice date
- Late payment: 1.5%/month (18% APR)
- All amounts in **[CURRENCY]**
- Expenses: Pre-approved only, at cost + 10%

---

## 7. CHANGE MANAGEMENT

### 7.1 Change Request Process
1. Client submits written Change Request (CR) via email/Project tool
2. Studio assesses impact (scope, timeline, cost) within 3 business days
3. Studio provides Change Order (CO) with revised timeline/cost
4. Client approves/rejects CO in writing
5. Approved CO becomes part of this SoW

### 7.2 Change Order Template
| Field | Details |
|-------|---------|
| CR Number | [CR-XXX] |
| Description | [What changes] |
| Reason | [Why needed] |
| Scope Impact | [Added/removed/modified deliverables] |
| Timeline Impact | [+/- days/weeks] |
| Cost Impact | [Additional/reduced fee] |
| New Timeline | [Revised milestone dates] |

---

## 8. ACCEPTANCE CRITERIA

### 8.1 General Acceptance
Each deliverable accepted when:
- [ ] All acceptance criteria in Section 2.1 met
- [ ] No Critical/High severity bugs open
- [ ] Medium bugs ≤ [3] (with workaround documented)
- [ ] Code reviewed and merged to `main`
- [ ] Deployed to staging and demoed
- [ ] Documentation updated (README, API docs, runbooks)

### 8.2 User Acceptance Testing (UAT)
- **Duration:** 10 business days from M6 delivery
- **Client provides:** Dedicated tester(s), test cases, bug reports via [Jira/GitHub/Linear]
- **Studio fixes:** Critical/High within 24h; Medium within 3 business days
- **Acceptance:** Client signs off or UAT period expires (deemed accepted)

### 8.3 Final Acceptance
Occurs at M7 (Production Deploy) + 14 days hypercare, or earlier if Client confirms in writing.

---

## 9. ASSUMPTIONS & DEPENDENCIES

### 9.1 Assumptions
- Client provides timely feedback (max 3 business days for reviews)
- Third-party APIs/services available and stable
- Client's infrastructure accessible for integration
- No major scope changes after M2 sign-off
- Client's team available for UAT during agreed window

### 9.2 Dependencies
| Dependency | Owner | Required By | Risk if Delayed |
|------------|-------|-------------|-----------------|
| [e.g., Third-party API access] | Client | M1 | Blocks backend development |
| [e.g., Design system approval] | Client | M1 | Blocks frontend development |
| [e.g., DNS/SSL certificate] | Client | M5 | Blocks production deploy |

---

## 10. RISKS & MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [e.g., Third-party API changes] | Medium | High | Abstract behind adapter; monitor changelog |
| [e.g., Scope creep] | High | Medium | Strict change control; weekly scope review |
| [e.g., Key person dependency] | Low | High | Pair programming; documentation; cross-training |
| [e.g., Browser compatibility issues] | Low | Medium | Test on target browsers weekly; use polyfills |

---

## 10. INTELLECTUAL PROPERTY (Per MSA)

This SoW incorporates the IP provisions of the Master Services Agreement. Key reminders:
- **Studio IP** (design system, reusable components, tools) remains Studio property — Client receives licence per MSA Section 4.4
- **Deliverable IP** transfers to Client on full payment
- **Studio Portfolio Rights** — Studio may display anonymised case study with Client permission

---

## 11. SIGNATURES

**STUDIO**

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

**CLIENT**

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

---

## APPENDIX A — PROJECT-SPECIFIC ACCEPTANCE CRITERIA DETAIL

[Attach detailed acceptance criteria per deliverable from Section 2.1]

---

## APPENDIX B — TECHNICAL SPECIFICATION TEMPLATE

[Attach or reference the Technical Specification document template]

---

*End of Statement of Work Template*
*Version: 1.0 (DRAFT — REQUIRES LEGAL REVIEW)*
*Classification: CONFIDENTIAL*