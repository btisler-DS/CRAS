import { expect, test } from "@playwright/test";

async function reset(page: import("@playwright/test").Page): Promise<void> {
  await page.request.post("/api/runtime", { data: { command: "reset" } });
  await page.goto("/");
}

async function selectPreset(
  page: import("@playwright/test").Page,
  name: "Blocked" | "Successful" | "Evidence failure",
): Promise<void> {
  await page.getByText("Demo presets", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

async function openExplanation(
  page: import("@playwright/test").Page,
): Promise<void> {
  const completedRunAction = page.getByRole("button", {
    name: "Inspect the decision",
    exact: true,
  });
  if (await completedRunAction.isVisible()) {
    await completedRunAction.click();
  } else {
    await page.getByRole("button", { name: "See why", exact: true }).click();
  }
  await expect(page.getByTestId("protocol-explanation")).toBeVisible();
}

async function runGuidedScenario(
  page: import("@playwright/test").Page,
  expectedVerdict: "AUTHORIZED" | "BLOCKED",
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
    "Recommendation only. No authority.",
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
    expectedVerdict === "AUTHORIZED"
      ? "The model recommendation did not authorize execution. CRAS authorized only after every required condition was satisfied and the evidence transaction committed."
      : "The model recommended proceeding, but CRAS blocked execution because patient identity was unresolved.",
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
    expectedVerdict === "AUTHORIZED"
      ? "1 adapter call after authorization"
      : "Zero adapter calls",
  );
  await expect(page.getByTestId("guided-floorplan")).toBeVisible();

  await expect(page.getByTestId("presentation-complete")).toBeVisible();
  await expect(page.getByTestId("presentation-focus")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Inspect the decision", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run another scenario", exact: true }),
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
      "CRAS authorizes actions using deterministic protocols.",
    );
    await expect(page.getByLabel("Model", { exact: true })).toHaveValue("Proceed");
    await expect(page.getByTestId("model-recommendation-display")).toHaveText(
      "Proceed",
    );
    await expect(page.getByTestId("protocol-verdict")).toHaveText("BLOCKED");
    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("execution-state")).toHaveText("STATIONARY");
    await expect(page.getByTestId("endpoint-consequence")).toHaveText("Stationary");
    await expect(page.getByTestId("headline-reason")).toContainText(
      "Patient identity unresolved",
    );
    await expect(page.getByTestId("guided-presentation")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Run scenario", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "See why", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("protocol-explanation")).toBeHidden();

    await runGuidedScenario(page, "BLOCKED", "Stationary");
    await expect(page.getByTestId("guided-authorization")).toContainText("BLOCKED");
    await expect(page.getByTestId("blocking-reasons")).toContainText(
      "Patient identity is unresolved",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("pharmacy");
    await expect(page.getByTestId("vision-frame")).toBeVisible();
    await expect(page.locator(".technical-disclosure")).not.toHaveAttribute("open");
    await expect(page.getByTestId("no-evidence")).toBeAttached();
    await expect(page.getByTestId("no-grant")).toBeAttached();
    await page
      .getByRole("button", { name: "Run another scenario", exact: true })
      .click();
    await expect(page.getByTestId("guided-presentation")).toHaveCount(0);
    await expect(page.getByTestId("interaction-layer")).toBeVisible();
  });

  test("live mission logs attention and instruction acknowledgments without authority", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Live mission", exact: true }).click();
    await expect(page.getByTestId("interaction-state")).toHaveText("IDLE");
    await expect(page.getByTestId("instruction")).toHaveText(
      "Awaiting instruction…",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");

    await page.getByRole("button", { name: "Alert robot", exact: true }).click();
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

    await page.getByRole("button", { name: "Give instruction", exact: true }).click();
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
      "Patient identity is unresolved",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
  });

  test("Scene 2: satisfying conditions reaches ready, never early authorization", async ({
    page,
  }) => {
    await openExplanation(page);
    await page.getByLabel("Patient identity verified").click();

    await expect(page.getByTestId("runtime-status")).toHaveText(
      "READY FOR EVIDENCE",
    );
    await expect(page.getByLabel("Patient identity verified")).toBeChecked();
    await expect(page.getByTestId("runtime-status")).not.toHaveText("AUTHORIZED");
    await expect(page.getByTestId("evidence-state")).toHaveText("NOT STARTED");
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("pharmacy");
  });

  test("Scene 3: committed authorization dispatches once and exports matching JSON", async ({
    page,
  }) => {
    await selectPreset(page, "Successful");
    await expect(page.getByTestId("runtime-status")).toHaveText(
      "READY FOR EVIDENCE",
    );

    await runGuidedScenario(page, "AUTHORIZED", "Moving");
    await openExplanation(page);

    await expect(page.getByTestId("runtime-status")).toHaveText("AUTHORIZED");
    await expect(page.getByTestId("evidence-state")).toHaveText("COMMITTED");
    await expect(page.getByTestId("execution-state")).toHaveText("EXECUTED");
    await expect(page.getByTestId("endpoint-consequence")).toHaveText("Arrived");
    await expect(page.getByTestId("adapter-calls")).toHaveText("1");
    await expect(page.getByTestId("robot-position")).toHaveText("Room 312");
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
    await openExplanation(page);
    await expect(page.getByRole("switch")).toBeChecked();

    await page
      .getByRole("button", { name: "Commit evidence & execute" })
      .click();

    await expect(page.getByTestId("runtime-status")).toHaveText(
      "EVIDENCE COMMIT FAILED",
    );
    await expect(page.getByTestId("evidence-state")).toHaveText("FAILED");
    await expect(page.getByTestId("execution-state")).toHaveText("STATIONARY");
    await expect(page.getByTestId("no-evidence")).toBeAttached();
    await expect(page.getByTestId("no-grant")).toBeAttached();
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("pharmacy");
  });

  test("reset restores the deterministic blocked scene", async ({ page }) => {
    await selectPreset(page, "Successful");
    await openExplanation(page);
    await page
      .getByRole("button", { name: "Commit evidence & execute" })
      .click();
    await expect(page.getByTestId("robot-position")).toHaveText("Room 312");

    await page.getByRole("button", { name: "Reset", exact: true }).click();

    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("pharmacy");
    await expect(page.getByLabel("Patient identity verified")).not.toBeChecked();

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
      "Zero adapter calls",
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
    await expect(page.getByTestId("robot-position")).toHaveText("pharmacy");

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
  });
});
