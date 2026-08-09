import ts from "typescript";

const localJavaScriptChunkPattern =
  /^(?:(?:\.\.?\/)+|\/|assets\/)[^"']+\.(?:m?js)(?:[?#].*)?$/u;

function moduleSyntaxLabel(node) {
  if (
    ts.isImportDeclaration(node) ||
    ts.isImportEqualsDeclaration(node) ||
    (ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
    (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)
  ) {
    return "import";
  }

  if (
    ts.isExportAssignment(node) ||
    ts.isExportDeclaration(node) ||
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    return "export";
  }

  return null;
}

function inspectBundle(node) {
  const label = moduleSyntaxLabel(node);
  if (label !== null) return { label, localChunk: false };

  if (ts.isStringLiteralLike(node) && localJavaScriptChunkPattern.test(node.text)) {
    return { label: null, localChunk: true };
  }

  let result = { label: null, localChunk: false };
  ts.forEachChild(node, (child) => {
    if (result.label === null && !result.localChunk) result = inspectBundle(child);
  });
  return result;
}

function unwrapParentheses(expression) {
  let unwrapped = expression;
  while (ts.isParenthesizedExpression(unwrapped)) unwrapped = unwrapped.expression;
  return unwrapped;
}

function isIifeEntrypoint(sourceFile) {
  if (sourceFile.statements.length !== 1) return false;
  const [statement] = sourceFile.statements;
  if (!statement || !ts.isExpressionStatement(statement)) return false;

  const expression = unwrapParentheses(statement.expression);
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapParentheses(expression.expression);
  return ts.isFunctionExpression(callee) || ts.isArrowFunction(callee);
}

export function validateContentScriptBundle(javascript) {
  if (typeof javascript !== "string" || javascript.trim().length === 0) {
    throw new Error("Content script bundle must be non-empty JavaScript.");
  }

  const sourceFile = ts.createSourceFile(
    "content-script.js",
    javascript,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const inspection = inspectBundle(sourceFile);

  if (inspection.label !== null) {
    throw new Error(
      `Content script bundle must be a classic script without ${inspection.label} syntax.`,
    );
  }

  if (inspection.localChunk) {
    throw new Error(
      "Content script bundle must be self-contained without a local JavaScript chunk.",
    );
  }

  if (!isIifeEntrypoint(sourceFile)) {
    throw new Error("Content script bundle must be a self-contained IIFE entrypoint.");
  }
}
