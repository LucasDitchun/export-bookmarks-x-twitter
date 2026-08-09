export const EXPECTED_MANIFEST_PERMISSIONS = Object.freeze([
  "activeTab",
  "sidePanel",
  "storage",
  "unlimitedStorage",
]);

export const EXPECTED_MANIFEST_HOST_PERMISSIONS = Object.freeze([
  "https://api.github.com/*",
]);

export function validateExactStringArray(actual, expected, fieldName) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) {
    throw new Error(`Manifest ${fieldName} must be an array of strings.`);
  }

  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((value, index) => value !== sortedExpected[index])
  ) {
    throw new Error(
      `Manifest ${fieldName} must be exactly: ${sortedExpected.join(", ")}.`,
    );
  }
}
