# AI-Civic-Reporter-SBproject

# Civic Issue Reporting System — MVP Specification

## 1. MVP Goal

Build the smallest working version that allows a citizen to report a civic issue and an authority to prioritize, claim, and resolve it.

The system must automatically analyze the issue description and assign one of four severity levels:

- **LOW**
- **MEDIUM**
- **HIGH**
- **CRITICAL**

---

## 2. Features the MVP Must Have

### 2.1 User Login & Registration

- Citizen registration and login.
- Authority login.
- Two roles:
  - `CITIZEN`
  - `AUTHORITY`
- JWT authentication.
- Password hashing.

### 2.2 Create Civic Issue

A citizen can create a report.

**Required fields:**

- Title
- Description
- Category
- Image
- Location

The system automatically records the report creation time.

### 2.3 Image Upload

- Citizen uploads an image as evidence.
- Validate image type and size.
- Store the image path/URL with the issue.

### 2.4 Location

- Show an interactive map.
- Citizen drops a marker for the issue.
- Store latitude and longitude.

### 2.5 NLP Severity Detection

- Analyze the issue description in the FastAPI backend.
- Calculate a severity score from `0–100`.
- Classify the issue as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.
- Store both severity and score with the issue.

### 2.6 Citizen Reports

- Citizen can view their submitted reports.
- Show:
  - Title
  - Category
  - Severity
  - Severity score
  - Status
- Citizen can open an individual report to see its details.

### 2.7 Authority Dashboard

- Authority can view all reports.
- Reports are ordered by severity/priority.
- Filter by:
  - Severity
  - Category
  - Status
- Authority can open complete issue details.

### 2.8 Claim Issue

- Authority can claim a pending issue.
- Record which authority claimed it.
- Change status from `PENDING` to `IN_PROGRESS`.

### 2.9 Resolve Issue

- Authority can mark an in-progress issue as resolved.
- Allow a resolution comment.
- Change status from `IN_PROGRESS` to `RESOLVED`.

### 2.10 Issue History

Record:

- Report creation.
- Claim/status changes.
- Resolution comment.

Citizen can view the complete history.

---

## 3. Issue Statuses

Only the following statuses are allowed:

```text
PENDING → IN_PROGRESS → RESOLVED
