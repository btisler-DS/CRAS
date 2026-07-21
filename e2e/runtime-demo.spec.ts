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
  await page.getByRole("button", { name: "See why", exact: true }).click();
  await expect(page.getByTestId("protocol-explanation")).toBeVisible();
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
    await expect(page.getByLabel("Model", { exact: true })).toHaveValue("Proceed");
    await expect(page.getByTestId("protocol-verdict")).toHaveText("BLOCKED");
    await expect(page.getByTestId("runtime-status")).toHaveText("UNAUTHORIZED");
    await expect(page.getByTestId("execution-state")).toHaveText("STATIONARY");
    await expect(page.getByTestId("headline-reason")).toContainText(
      "Patient identity is unresolved",
    );
    await expect(
      page.getByRole("button", { name: "Run scenario", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "See why", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("protocol-explanation")).toBeHidden();

    await page.getByRole("button", { name: "Run scenario", exact: true }).click();
    await expect(page.getByTestId("protocol-verdict")).toHaveText("BLOCKED");
    await expect(page.getByTestId("blocking-reasons")).toContainText(
      "Patient identity is unresolved",
    );
    await expect(page.getByTestId("adapter-calls")).toHaveText("0");
    await expect(page.getByTestId("robot-position")).toHaveText("pharmacy");
    await expect(page.getByTestId("vision-frame")).toBeVisible();
    await expect(page.locator(".technical-disclosure")).not.toHaveAttribute("open");
    await expect(page.getByTestId("no-evidence")).toBeAttached();
    await expect(page.getByTestId("no-grant")).toBeAttached();
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

    await openExplanation(page);
    await page
      .getByRole("button", { name: "Commit evidence & execute" })
      .click();

    await expect(page.getByTestId("runtime-status")).toHaveText("AUTHORIZED");
    await expect(page.getByTestId("evidence-state")).toHaveText("COMMITTED");
    await expect(page.getByTestId("execution-state")).toHaveText("EXECUTED");
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
  });
});
