const defaultDelay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function waitForExtensionContext(
  devTools,
  expectedUrl,
  {
    delay = defaultDelay,
    now = Date.now,
    pollIntervalMilliseconds = 100,
    timeoutMilliseconds = 15_000,
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  const expression = `(() => location.href === ${JSON.stringify(
    expectedUrl,
  )} && Boolean(globalThis.chrome?.storage?.local))()`;
  let lastError;

  while (now() < deadline) {
    try {
      const evaluation = await devTools.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (!evaluation.exceptionDetails && evaluation.result?.value === true) return;
      lastError = evaluation.exceptionDetails?.exception?.description;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMilliseconds);
  }

  throw new Error(
    `The extension context did not become ready at ${expectedUrl}${
      lastError ? ` (${lastError})` : ""
    }.`,
  );
}
