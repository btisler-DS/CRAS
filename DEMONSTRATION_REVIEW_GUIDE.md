# CRAS Demonstration Review Guide

## Purpose

Evaluate the demonstration as a first-time user.

Do not evaluate the implementation.

Do not evaluate the code.

Do not evaluate the architecture.

Evaluate only whether the interface communicates the intended story.

The intended story is:

> AI suggested proceeding. CRAS blocked the unsafe delivery. Therefore the vehicle never moved.

---

# General Rules

Review every screen as though you have never seen CRAS.

Whenever you reach a new screen ask yourself:

1. What happened?
2. Why did it happen?
3. What can I do next?

If the interface cannot answer all three questions immediately, stop and record the problem before continuing.

Do not continue until the current screen makes sense.

---

# Navigation Rules

Never assume the user understands previous screens.

Never assume the user understands CRAS terminology.

Never assume the user knows what a button does.

Every button must communicate its outcome before it is pressed.

If a button causes uncertainty, document it.

---

# Button Review

For every button verify:

- The label clearly describes what will happen.
- The action is available.
- The action has a logical purpose.
- The user understands why they would press it.

If any answer is no:

Document the problem.

Do not redesign the system.

Describe why the action is confusing.

---

# Disabled Controls

Every disabled control must answer:

Why is it disabled?

Can it ever become enabled?

If the answer is not obvious:

Replace the control with explanatory text.

Never leave the user wondering whether something is broken.

---

# Navigation Review

Every page must have an obvious next action.

Acceptable next actions include:

- Back to Decision Summary
- Modify this Case
- Choose Another Case
- View Technical Proof

If a page ends without an obvious next step:

Record it as a navigation failure.

---

# Diagram Review

Every visual element must answer a question.

Examples:

Vehicle diagram

Question answered:

> What happened to the vehicle?

If a diagram exists without answering a question:

Record it as unnecessary or incomplete.

Do not assume users understand engineering diagrams.

---

# Review Sequence

## Step 1

Open the application.

Do nothing.

Describe your first impression.

---

## Step 2

Press:

Run Scenario

Do not click anything else.

Watch the complete guided presentation.

---

## Step 3

After the presentation completes ask:

- Do I understand what happened?
- Do I understand why it happened?
- Do I know what I should do next?

If any answer is no:

Stop.

Document the reason.

---

## Step 4

Choose:

Review Why

Evaluate only that workflow.

Do not inspect technical information.

Verify:

- explanation is understandable
- actions are obvious
- no dead controls exist
- no dead ends exist

Return to the Decision Summary.

---

## Step 5

Choose:

Choose Another Case

Select a different scenario.

Run it.

Repeat Steps 2–4.

---

## Step 6

Choose:

View Technical Proof

Evaluate only whether technical evidence supports the decision.

Do not judge implementation quality.

Return to the Decision Summary.

---

# Failure Conditions

Record a failure whenever:

- you ask "What am I looking at?"
- you ask "What should I click?"
- you ask "Why is this here?"
- you ask "What does this button do?"
- you ask "Why is this disabled?"
- you ask "Am I finished?"
- you ask "What happens if I press this?"

Each occurrence should include:

- Screen
- User question
- Why the interface failed to answer it

---

# Success Criteria

The demonstration succeeds when a first-time user can complete every path without uncertainty.

Every screen should immediately answer:

1. What happened?
2. Why?
3. What can I do next?

If any screen fails one of those questions, record the issue before continuing.
