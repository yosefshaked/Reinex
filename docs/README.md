# Documentation Index

This folder contains comprehensive documentation for the TutTiud project, organized by topic.

---

## 🆕 Latest Addition: Code Duplication Analysis (2025-01)

**Start Here:** [`code-duplication-index.md`](code-duplication-index.md)

A comprehensive 4-document analysis of code duplication across the codebase, with actionable refactoring plans.

**Quick Access:**
- **5-min summary:** [`code-duplication-summary.md`](code-duplication-summary.md) - Numbers, priorities, quick wins
- **Visual guide:** [`code-duplication-visual.md`](code-duplication-visual.md) - Diagrams and architecture
- **Full analysis:** [`code-duplication-analysis.md`](code-duplication-analysis.md) - Complete technical details
- **Progress tracking:** [`feature-loose-reports-progress.md`](feature-loose-reports-progress.md) - Implementation status

**Key Findings:**
- 950+ lines of duplicated code identified
- 20+ files affected
- 500+ lines can be eliminated through refactoring
- 3-phase implementation plan ready

---

## 📚 Documentation by Category

### Feature Implementation

#### Loose Session Reports (2025-01)
- [`feature-loose-reports-progress.md`](feature-loose-reports-progress.md) - Complete feature tracker with phases 0-6 and edge cases

#### Document Management (Phase 2)
- [`phase2-document-management.md`](phase2-document-management.md) - Polymorphic documents table architecture and implementation

#### Student Data Maintenance (2025-02)
- [`student-data-maintenance-qa.md`](student-data-maintenance-qa.md) - Comprehensive QA plan for CSV import/export feature

---

### Storage & Deployment

#### Storage Configuration
- [`storage-config-implementation.md`](storage-config-implementation.md) - Cross-system storage profile architecture
- [`storage-drivers-implementation.md`](storage-drivers-implementation.md) - S3/Azure/GCS driver implementation
- [`storage-deployment-guide.md`](storage-deployment-guide.md) - Deployment steps for storage features
- [`storage-ui-states.md`](storage-ui-states.md) - Frontend UI state machine documentation

---

### Security & Permissions

#### Permissions System
- [`permissions-registry.md`](permissions-registry.md) - Permission registry architecture and usage
- [`invitation-expiry.md`](invitation-expiry.md) - Invitation expiry calculation and configuration

#### Backup & Restore
- [`backup-override.md`](backup-override.md) - Backup cooldown override mechanism

---

### Development Tools & Processes

#### API Validation
- [`api-validation-tool.md`](api-validation-tool.md) - API endpoint validation tool documentation
- [`api-validation-quick-reference.md`](api-validation-quick-reference.md) - Quick reference for validation patterns
- [`api-validator-enhancement-summary.md`](api-validator-enhancement-summary.md) - Enhancement history

#### Code Quality
- [`AI-Coder-Gotchas.md`](AI-Coder-Gotchas.md) - Common pitfalls and patterns to avoid
- [`code-duplication-*`](code-duplication-index.md) - Duplication analysis (4 documents)

#### Bug Fixes
- [`RACE_CONDITION_FIX.md`](RACE_CONDITION_FIX.md) - Race condition resolution documentation

---

### Design & Assets
- [`landing-page-screenshots.md`](landing-page-screenshots.md) - Landing page design screenshots

---

## 📖 Reading Guides by Role

### For Product Owners / Managers
**Start with these for context:**
1. `code-duplication-summary.md` - Understand technical debt
2. `feature-loose-reports-progress.md` - Feature implementation status
3. `student-data-maintenance-qa.md` - QA coverage for data features

### For Developers (New to Project)
**Onboarding reading order:**
1. `AI-Coder-Gotchas.md` - Common patterns and pitfalls
2. `code-duplication-index.md` - Architecture and refactoring plans
3. `api-validation-tool.md` - How to validate your API work
4. Feature-specific docs as needed

### For Developers (Adding Features)
**Reference while coding:**
1. `code-duplication-analysis.md` - Avoid duplicating existing patterns
2. `api-validation-quick-reference.md` - Quick API validation checks
3. `permissions-registry.md` - How to check/add permissions
4. `storage-config-implementation.md` - If working with files/storage

### For QA Engineers
**Testing references:**
1. `student-data-maintenance-qa.md` - Complete test cases for CSV features
2. `feature-loose-reports-progress.md` - Acceptance criteria for loose reports
3. `storage-ui-states.md` - UI states to test for storage features

### For DevOps / Deployment
**Deployment guides:**
1. `storage-deployment-guide.md` - Storage feature deployment steps
2. `api-validator-enhancement-summary.md` - Validation tool setup
3. `permissions-registry.md` - Permission initialization

---

## 🔍 Quick Search Guide

### Looking for...

**Architecture decisions?**
→ `code-duplication-analysis.md` Section 11 (Key Architectural Decisions)  
→ `storage-config-implementation.md` (Cross-system design)  
→ `phase2-document-management.md` (Polymorphic table design)

**Implementation checklists?**
→ `feature-loose-reports-progress.md` (Phases 0-6 checkboxes)  
→ `code-duplication-summary.md` (Quick win checklist)  
→ `storage-deployment-guide.md` (Deployment steps)

**Testing procedures?**
→ `student-data-maintenance-qa.md` (Comprehensive test cases)  
→ `code-duplication-analysis.md` Section 9 (Testing strategy)  
→ `storage-ui-states.md` (UI state testing)

**Common pitfalls?**
→ `AI-Coder-Gotchas.md` (RTL, forms, selects, CSV patterns)  
→ `code-duplication-analysis.md` (Anti-patterns to avoid)  
→ `RACE_CONDITION_FIX.md` (Race condition patterns)

**API patterns?**
→ `api-validation-quick-reference.md` (Validation patterns)  
→ `code-duplication-analysis.md` Section 5 (API client patterns)  
→ `storage-drivers-implementation.md` (Storage API patterns)

---

## 📊 Document Statistics

**Total Documents:** 20  
**Latest Update:** 2025-01 (Code duplication analysis)  
**Most Comprehensive:** `code-duplication-analysis.md` (~1000 lines)  
**Quick Reference:** `api-validation-quick-reference.md`, `AI-Coder-Gotchas.md`  

**Documentation Coverage:**
- ✅ Feature implementations
- ✅ Architecture decisions
- ✅ Testing strategies
- ✅ Deployment guides
- ✅ Code quality analysis
- ✅ Common pitfalls
- ⏳ Future: More feature-specific guides as needed

---

## 🔄 Recent Updates

**2025-01-XX:**
- Added comprehensive code duplication analysis (4 documents)
- Updated feature-loose-reports-progress.md with #12 (refactoring)
- Identified 500+ lines of duplicated code with refactoring plan

**2025-02:**
- Added student data maintenance QA documentation
- Updated storage implementation guides

**2025-11:**
- Added polymorphic documents architecture
- Updated permissions registry documentation
- Added storage deployment guide

---

## 📝 Contributing to Documentation

### When to Create New Docs
- New feature implementation (create `feature-*.md`)
- Architecture changes (update existing or create `architecture-*.md`)
- Bug fixes with broader implications (create `BUG_FIX_*.md`)
- Deployment procedures (update `*-deployment-guide.md`)

### Documentation Standards
- Use Markdown formatting
- Include table of contents for long documents
- Add code examples with syntax highlighting
- Reference line numbers when discussing specific code
- Include "Before/After" for refactoring docs
- Keep README.md updated when adding new docs

### Maintenance
- Update this README when adding new docs
- Keep links functional
- Update "Recent Updates" section
- Archive outdated docs (move to `/docs/archive/` if needed)

---

## 🤝 Getting Help

**Can't find what you're looking for?**
1. Check this README's Quick Search Guide
2. Use grep/search across all docs
3. Check main project AGENTS.md and ProjectDoc/
4. Ask in team chat with reference to which doc you checked

**Found an issue with documentation?**
1. Open a PR to fix it
2. Update the relevant doc
3. Update this README if structure changed

---

**Last Updated:** 2025-01-XX  
**Maintainer:** Development Team  
**Status:** ✅ Active and up-to-date
