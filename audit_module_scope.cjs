// One-off audit script: walk every .ts/.tsx file under src/, parse it with
// the TypeScript compiler API, and report every top-level (module-scope)
// statement that is NOT a pure declaration (import/export/interface/type/
// const-or-let-with-a-literal-or-arrow-function-initializer/function
// declaration/class declaration). Anything else executes immediately when
// the module is first imported, before any component ever renders — which
// is exactly the class of bug that produces "blank white screen, nothing
// in #root" while index.html's static shell still displays.
const ts = require('typescript')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'src')
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(p)
  }
}
walk(SRC)

function isSafeDeclaration(stmt, sf) {
  switch (stmt.kind) {
    case ts.SyntaxKind.ImportDeclaration:
    case ts.SyntaxKind.ExportDeclaration:
    case ts.SyntaxKind.ExportAssignment:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.EmptyStatement:
      return true
    case ts.SyntaxKind.VariableStatement: {
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.initializer) continue
        const init = decl.initializer
        const kind = init.kind
        const safeKinds = [
          ts.SyntaxKind.ArrowFunction,
          ts.SyntaxKind.FunctionExpression,
          ts.SyntaxKind.StringLiteral,
          ts.SyntaxKind.NumericLiteral,
          ts.SyntaxKind.TrueKeyword,
          ts.SyntaxKind.FalseKeyword,
          ts.SyntaxKind.NullKeyword,
          ts.SyntaxKind.ObjectLiteralExpression,
          ts.SyntaxKind.ArrayLiteralExpression,
          ts.SyntaxKind.Identifier,
          ts.SyntaxKind.PropertyAccessExpression,
          ts.SyntaxKind.TemplateExpression,
          ts.SyntaxKind.NoSubstitutionTemplateLiteral,
        ]
        if (safeKinds.includes(kind)) continue
        if (kind === ts.SyntaxKind.AsExpression || kind === ts.SyntaxKind.NonNullExpression) continue
        return false
      }
      return true
    }
    default:
      return false
  }
}

let flaggedAny = false
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  for (const stmt of sf.statements) {
    if (!isSafeDeclaration(stmt, sf)) {
      flaggedAny = true
      const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart())
      const snippet = stmt.getText(sf).split('\n')[0].slice(0, 120)
      console.log(`${path.relative(__dirname, file)}:${line + 1}  [${ts.SyntaxKind[stmt.kind]}]  ${snippet}`)
    }
  }
}
if (!flaggedAny) console.log('No risky top-level (module-scope) executable statements found.')
