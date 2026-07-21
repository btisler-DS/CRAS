import { expect, test } from "@playwright/test";

async function reset(page: import("@playwright/test").Page): Promise<void> {
  await page.request.post("/api/runtime", { data: { command: "reset" } });
  await page.goto("/");
}

async function selectPreset(
  page: import("@playwright/test").Page,
  name: "Blocked" | "Successful" | "Evidence failure",
): Promise<void> {
  const cardName = {
    Blocked: "Wrong patient Patient identity is not verified Expected · Delivery blocked",
    Successful:
      "Successful delivery Every safety check is complete Expected · Delivery approved",
    "Evidence failure":
      "Verification record unavailable All checks pass, but the record cannot be saved Expected · Delivery blocked",
  }[name];
  await page.getByRole("button", { name: cardName, exact: true }).click();
}

async function openExplanation(
  page: import("@playwright/test").Page,
): Promise<void> {
  const completedRunAction = page.getByRole("button", {
    name: /^Review why delivery was (blocked|approved)/,
  });
  if ((await completedRunAction.count()) > 0 && (await completedRunAction.isVisible())) {
    await completedRunAction.first().click();
  } else {
    await page.getByRole("button", { name: "Review verification", exact: true }).click();
  }
  await expect(page.getByTestId("protocol-explanation")).toBeVisible();
}

async function runGuidedScenario(
  page: import("@playwright/test").Page,
  expectedVerdict: "APPROVED" | "BLOCKED",
  expectedEndpoint: "Moving" | "Stationary",
): Promise<void> {
  await page.getByRole("button", { name: "Run scenario", exact: true }).click();

  const presentation = page.getByTestId("guided-presentation");
  await expect(presentation).toBeVisible();
  await expect(presentation).toHaveAttribute("data-stage", "mission");
  await expect(page.getByTestId("guided-mission")).toContainText(
    "Deliver insulin to Room 312",
  );
  await expect(
    page.getByRole("button", { name: "Skip animation", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("interaction-layer")).toHaveAttribute("inert", "");

  await expect(presentation).toHaveAttribute("data-stage", "recommendation");
  await expect(page.getByTestId("guided-mission")).toContainText(
    "Deliver insulin to Room 312",
  );
  await expect(page.getByTestId("guided-recommendation")).toContainText("Proceed");
  await expect(page.getByTestId("guided-recommendation")).toContainText(
    "Advisory only. It cannot approve delivery.",
  );

  await expect(presentation).toHaveAttribute("data-stage", "authorization");
  await expect(page.getByTestId("guided-mission")).toBeVisible();
  await expect(page.getByTestId("guided-recommendation")).toBeVisible();
  await expect(
    page.getByTestId("guided-condition-PATIENT_IDENTITY_VERIFIED"),
  ).toHaveAttribute("data-revealed", "true");
  await expect(
    page.getByTestId("guided-condition-PATIENT_IDENTITY_VERIFIED"),
  ).toBeVisible();
  await expect(page.getByTestId("guided-condition-evidence")).toHaveAttribute(
    "data-revealed",
    "true",
  );
  await expect(page.getByTestId("guided-condition-evidence")).toBeVisible();

  await expect(page.getByTestId("guided-authorization")).toContainText(
    expectedVerdict,
  );
  await expect(page.getByTestId("causal-statement")).toContainText(
    expectedVerdict === "APPROVED"
      ? "The AI suggestion did not approve the delivery. CRAS approved it only after every required check passed and the verification record was saved."
      : "The AI suggested proceeding, but CRAS blocked the delivery because patient identity was not verified.",
  );

  await expect(presentation).toHaveAttribute("data-stage", "consequence");
  await expect(page.getByTestId("guided-mission")).toBeVisible();
  await expect(page.getByTestId("guided-recommendation")).toBeVisible();
  await expect(page.getByTestId("guided-authorization")).toContainText(
    expectedVerdict,
  );
  await expect(page.getByTestId("guided-consequence")).toContainText(
    expectedEndpoint,
  );
  await expect(page.getByTestId("guided-adapter-result")).toHaveText(
    expectedVerdict === "APPROVED"
      ? "1 delivery command sent after approval"
      : "No delivery command was issued",
  );
  await expect(page.getByTestId("guided-floorplan")).toBeVisible();

  await expect(page.getByTestId("presentation-complete")).toBeVisible();
  await expect(page.getByTestId("presentation-focus")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "What would you like to do next?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Review why delivery was ${
        expectedVerdict === "APPROVED" ? "approved" : "blocked"
      } See the verification and next required action.`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Choose another case Select a different clinical situation.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "View technical audit Inspect the formal evidence and execution trail.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(presentation).toBeVisible();
  await expect(page.getByTestId("interaction-layer")).not.toHaveAttribute("inert", "");
}

test.describe("Constitutional Runtime browser demonstration", () => {
  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("Scene 1: blocked state is visible and robot remains stationary", async ({
    page,
  }) => {
    await expect(page.getByTestId("first-glance")).toBeVisible();
    await expect(page.getByTestId("instruction")).toContainText(
      "Deliver medication to Room 312.",
    );
    await expect(page.getByTestId("first-glance")).toContainText(
      "CRAS applies the same safety checks to every delivery.",
    );
    await expect(page.getByTestId("model-recommendation-display")).toHaveText(
      "Proceed",
    );
    await expect(page.getByTestId("protocol-verdict")).toHaveText("BLOCKED");
    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("execution-state")).toHaveText("STATIONARY");
    await expect(page.getByTestId("endpoint-consequence")).toHaveText("At Pharmacy");
    await expect(page.getByTestId("headline-reason")).toContainText(
      "Patient verification required",
    );
    await expect(page.getByTestId("guided-presentation")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Run scenario", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review verification", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("protocol-explanation")).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Vehicle outcome", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("case-summary")).toContainText(
      "Patient verification required.",
    );
    await expect(page.getByTestId("case-summary")).toContainText(
      "No delivery command was issued.",
    );
    await expect(
      page.locator("details").filter({ hasText: "Optional vehicle camera" }),
    ).not.toHaveAttribute("open", "");
    await expect(page.locator(".technical-disclosure")).not.toHaveAttribute("open");

    await runGuidedScenario(page, "BLOCKED", "Stationary");
    await expect(page.getByTestId("guided-authorization")).toContainText("BLOCKED");
    await expect(page.getByTestId("blocking-reasons")).toContainText(
      "Patient verification required",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("Pharmacy");
    await expect(page.getByTestId("actual-movement")).toHaveText("None");
    await expect(page.getByTestId("planned-path-status")).toContainText(
      "Not travelled",
    );
    await expect(page.getByTestId("vehicle-outcome-explanation")).toHaveText(
      "CRAS issued no delivery command, so the vehicle remained at the Pharmacy.",
    );

    await page
      .getByRole("button", {
        name: "Review why delivery was blocked See the verification and next required action.",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("protocol-explanation")).toBeVisible();
    await expect(page.getByTestId("protocol-explanation")).toBeFocused();
    await expect(page.getByTestId("guided-presentation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Why was this delivery blocked?" }),
    ).toBeVisible();
    await expect(page.getByTestId("review-model-suggestion")).toContainText("Proceed");
    await expect(page.getByTestId("release-guidance")).toHaveText(
      "Verify the patient's identity before CRAS can release the delivery.",
    );
    await expect(
      page.getByRole("button", {
        name: "Record verification and release delivery",
        exact: true,
      }),
    ).toHaveCount(0);

    await page
      .getByTestId("protocol-explanation")
      .getByRole("button", { name: "Back to decision summary", exact: true })
      .click();
    await expect(page.getByTestId("protocol-explanation")).toBeHidden();
    await expect(page.getByTestId("presentation-focus")).toBeFocused();
    await expect(page.getByTestId("guided-presentation")).toBeVisible();

    await page
      .getByRole("button", {
        name: "View technical audit Inspect the formal evidence and execution trail.",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("technical-audit")).toHaveAttribute("open", "");
    await expect(page.getByTestId("technical-audit-summary")).toBeFocused();
    await expect(page.getByTestId("guided-presentation")).toBeVisible();

    await page
      .getByTestId("technical-audit")
      .getByRole("button", { name: "Back to decision summary", exact: true })
      .click();
    await expect(page.getByTestId("technical-audit")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("presentation-focus")).toBeFocused();

    await page
      .getByRole("button", {
        name: "Choose another case Select a different clinical situation.",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("scenario-library")).toBeFocused();
    await expect(page.getByTestId("guided-presentation")).toBeVisible();
    await expect(page.locator(".technical-disclosure")).not.toHaveAttribute("open", "");

    await page
      .getByTestId("scenario-library")
      .getByRole("button", { name: "Back to decision summary", exact: true })
      .click();
    await expect(page.getByTestId("presentation-focus")).toBeFocused();
    await expect(page.getByTestId("guided-presentation")).toBeVisible();
    await expect(page.getByTestId("no-evidence")).toBeAttached();
    await expect(page.getByTestId("no-grant")).toBeAttached();
  });

  test("live mission logs attention and instruction acknowledgments without authority", async ({
    page,
  }) => {
    await page.getByText("Technical audit record", { exact: true }).click();
    await page
      .getByRole("button", { name: "Start new request", exact: true })
      .click();
    await expect(page.getByTestId("interaction-state")).toHaveText("IDLE");
    await expect(page.getByTestId("instruction")).toHaveText(
      "Awaiting instruction…",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");

    await page.getByRole("button", { name: "Notify vehicle", exact: true }).click();
    await expect(page.getByTestId("interaction-state")).toHaveText(
      "ATTENTION ACKNOWLEDGED",
    );
    await expect(page.getByTestId("interaction-acknowledgment")).toContainText(
      "listening",
    );
    await expect(page.getByTestId("instruction")).toHaveText(
      "Awaiting instruction…",
    );
    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");

    await page
      .getByRole("button", { name: "Send delivery request", exact: true })
      .click();
    await expect(page.getByTestId("interaction-state")).toHaveText(
      "INSTRUCTION ACKNOWLEDGED",
    );
    await expect(page.getByTestId("instruction")).toContainText(
      "Deliver medication to Room 312.",
    );
    await expect(page.getByTestId("event-timeline")).toContainText(
      "INSTRUCTION ACKNOWLEDGED",
    );
    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("blocking-reasons")).toContainText(
      "Patient verification required",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
  });

  test("Scene 2: satisfying conditions reaches ready, never early authorization", async ({
    page,
  }) => {
    await openExplanation(page);
    await page
      .getByTestId("protocol-explanation")
      .getByRole("button", { name: "Modify this case", exact: true })
      .click();
    await expect(page.getByLabel("Patient identity verified")).toBeFocused();
    await page.getByLabel("Patient identity verified").click();

    await expect(page.getByTestId("runtime-status")).toHaveText(
      "READY FOR EVIDENCE",
    );
    await expect(page.getByLabel("Patient identity verified")).toBeChecked();
    await expect(page.getByTestId("runtime-status")).not.toHaveText("AUTHORIZED");
    await expect(page.getByTestId("evidence-state")).toHaveText("NOT STARTED");
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("Pharmacy");
    await expect(
      page.getByRole("heading", { name: "Vehicle outcome", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("case-comparison")).toContainText(
      "Patient verification",
    );
    await expect(page.getByTestId("case-comparison")).toContainText(
      "Verification required",
    );
    await expect(page.getByTestId("case-comparison")).toContainText("Verified");
    await expect(page.getByTestId("case-comparison")).not.toContainText(
      "Medication verification",
    );
    await expect(page.getByTestId("case-comparison")).not.toContainText(
      "Active order verification",
    );
    await expect(
      page.getByRole("button", {
        name: "Record verification and release delivery",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("Scene 3: committed authorization dispatches once and exports matching JSON", async ({
    page,
  }) => {
    await selectPreset(page, "Successful");
    await expect(page.getByTestId("runtime-status")).toHaveText(
      "READY FOR EVIDENCE",
    );

    await runGuidedScenario(page, "APPROVED", "Moving");
    await openExplanation(page);

    await expect(page.getByTestId("runtime-status")).toHaveText("AUTHORIZED");
    await expect(page.getByTestId("evidence-state")).toHaveText("COMMITTED");
    await expect(page.getByTestId("technical-execution-state")).toHaveText(
      "EXECUTED",
    );
    await expect(page.getByTestId("guided-consequence")).toContainText("Moving");
    await expect(page.getByTestId("guided-presentation")).toBeVisible();
    await expect(page.getByTestId("adapter-calls")).toHaveText("1");
    await expect(page.getByTestId("robot-position")).toHaveText("Room 312");
    await expect(page.getByTestId("actual-movement")).toHaveText(
      "Pharmacy → Room 312",
    );
    await expect(page.getByTestId("planned-path-status")).toContainText(
      "Travelled after approval",
    );
    await expect(page.getByTestId("vehicle-outcome-explanation")).toHaveText(
      "CRAS approved the delivery, and the simulated vehicle traveled from Pharmacy to Room 312.",
    );
    await expect(
      page.getByRole("button", {
        name: "Record verification and release delivery",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByTestId("evidence-record")).toContainText("demo-0001");
    await expect(page.getByTestId("grant-details")).toContainText("demo-0002");
    await expect(page.getByTestId("event-timeline")).toContainText("DISPATCHED");
    await expect(page.getByTestId("event-timeline")).toContainText("EXECUTED");

    const displayedText = await page.getByTestId("evidence-json").textContent();
    expect(displayedText).not.toBeNull();
    const displayed = JSON.parse(displayedText ?? "null") as unknown;
    const exportResponse = await page.request.get("/api/runtime?export=1");
    expect(exportResponse.ok()).toBe(true);
    expect(await exportResponse.json()).toEqual(displayed);
  });

  test("Scene 4: repository failure denies authorization and prevents motion", async ({
    page,
  }) => {
    await selectPreset(page, "Evidence failure");
    await expect(page.getByTestId("runtime-status")).toHaveText(
      "READY FOR EVIDENCE",
    );
    await page.getByRole("button", { name: "Run scenario", exact: true }).click();
    await page
      .getByRole("button", { name: "Skip animation", exact: true })
      .click();

    await expect(page.getByTestId("runtime-status")).toHaveText(
      "EVIDENCE COMMIT FAILED",
    );
    await expect(page.getByTestId("evidence-state")).toHaveText("FAILED");
    await expect(page.getByTestId("technical-execution-state")).toHaveText(
      "STATIONARY",
    );
    await expect(page.getByTestId("no-evidence")).toBeAttached();
    await expect(page.getByTestId("no-grant")).toBeAttached();
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("Pharmacy");
    await expect(page.getByTestId("blocking-reasons")).toContainText(
      "verification record could not be saved",
    );
    await expect(page.getByTestId("vehicle-outcome-explanation")).toHaveText(
      "Although every safety check passed, the verification record could not be saved, so CRAS never released the vehicle.",
    );

    await openExplanation(page);
    await expect(page.getByTestId("release-guidance")).toContainText(
      "verification record is available",
    );
    await expect(
      page.getByRole("button", {
        name: "Record verification and release delivery",
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("reset restores the deterministic blocked scene", async ({ page }) => {
    await selectPreset(page, "Successful");
    await openExplanation(page);
    await page
      .getByTestId("protocol-explanation")
      .getByRole("button", { name: "Modify this case", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record verification and release delivery" })
      .click();
    await expect(page.getByTestId("robot-position")).toHaveText("Room 312");
    await expect(page.getByTestId("guided-presentation")).toHaveAttribute(
      "data-stage",
      "consequence",
    );
    await expect(page.getByTestId("presentation-focus")).toBeFocused();

    await page
      .getByRole("button", {
        name: "View technical audit Inspect the formal evidence and execution trail.",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Reset demonstration", exact: true })
      .click();

    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("Pharmacy");
    await openExplanation(page);
    await page
      .getByTestId("protocol-explanation")
      .getByRole("button", { name: "Modify this case", exact: true })
      .click();
    await expect(page.getByLabel("Patient identity verified")).not.toBeChecked();
    await page
      .getByTestId("protocol-explanation")
      .getByRole("button", { name: "Back to decision summary", exact: true })
      .click();

    await page.getByRole("button", { name: "Run scenario", exact: true }).click();
    await expect(page.getByTestId("guided-presentation")).toHaveAttribute(
      "data-stage",
      "mission",
    );
    await page
      .getByRole("button", { name: "Skip animation", exact: true })
      .click();
    await expect(page.getByTestId("guided-presentation")).toHaveAttribute(
      "data-stage",
      "consequence",
      { timeout: 2_000 },
    );
    await expect(page.getByTestId("guided-adapter-result")).toHaveText(
      "No delivery command was issued",
    );
  });

  test("unsupported UI/API commands cannot bypass protected dispatch", async ({
    page,
  }) => {
    const bypass = await page.request.post("/api/runtime", {
      data: {
        command: "dispatch",
        action: { instruction: "Deliver medication to Room 312." },
      },
    });
    expect(bypass.status()).toBe(400);

    await page.reload();
    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("Pharmacy");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Run scenario", exact: true }).click();
    await expect(page.getByTestId("guided-presentation")).toHaveAttribute(
      "data-stage",
      "consequence",
      { timeout: 2_000 },
    );
    await expect(page.getByTestId("guided-mission")).toBeVisible();
    await expect(page.getByTestId("guided-recommendation")).toBeVisible();
    await expect(page.getByTestId("guided-authorization")).toContainText("BLOCKED");
    await expect(page.getByTestId("guided-consequence")).toContainText("Stationary");
    await expect(
      page.getByRole("heading", { name: "What would you like to do next?" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "View technical audit Inspect the formal evidence and execution trail.",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("technical-audit")).toHaveAttribute("open", "");
    await expect(page.getByTestId("technical-audit-summary")).toBeFocused();
    await expect(page.getByTestId("guided-presentation")).toBeVisible();
    await page
      .getByTestId("technical-audit")
      .getByRole("button", { name: "Back to decision summary", exact: true })
      .click();
    await expect(page.getByTestId("technical-audit")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("presentation-focus")).toBeFocused();
  });
});
