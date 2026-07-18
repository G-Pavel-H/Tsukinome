---
name: implement-user-story
description: Run a natural-language task or user story through the Tsukinome test-first workflow (spec → plan → decompose → TDD implement → review).
argument-hint: Describe the task or user story to implement
agent: tsukinome
---

Run the following task or user story through the full Tsukinome workflow, starting at the **Spec**
phase and delegating through each specialist agent in order. Honor every guardrail: test-first,
the human approval gate at the plan, and the round cap.

Task / user story:

${input:task:Describe the task or user story to implement (e.g. "Users can reset their password via an emailed link")}
