#!/usr/bin/env node

/**
 * Setup ESLint for Obsidian Plugin
 * 
 * This script:
 * - Updates package.json with ESLint 9 devDependencies and scripts
 * - Ensures TypeScript version is >=4.8.4 (required for ESLint compatibility)
 * - Generates eslint.config.mjs (flat config) configuration file
 * - Generates .npmrc configuration file
 * - Copies lint-wrapper.mjs for helpful linting success messages
 * 
 * Usage: node scripts/setup-eslint.mjs
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ESLINT_DEPS = {
  "@eslint/js": "^9.30.1",
  "@eslint/json": "^0.14.0",
  "@typescript-eslint/eslint-plugin": "^8.33.1",
  "@typescript-eslint/parser": "^8.33.1",
  "eslint": "^9.39.1",
  "eslint-plugin-obsidianmd": "^0.1.9",
  "globals": "^14.0.0",
  "typescript-eslint": "^8.35.1"
};

const ESLINT_SCRIPTS = {
  "lint": "node scripts/lint-wrapper.mjs",
  "lint:fix": "node scripts/lint-wrapper.mjs --fix"
};

const MIN_TYPESCRIPT_VERSION = "^4.8.4";

function generateLintWrapper() {
  return `#!/usr/bin/env node

/**
 * ESLint wrapper that adds helpful success messages
 */

import { spawn } from 'child_process';
import process from 'process';

const args = process.argv.slice(2);
const hasFix = args.includes('--fix');

// Run ESLint
const eslint = spawn('npx', ['eslint', '.', ...args], {
	stdio: 'inherit',
	shell: true
});

eslint.on('close', (code) => {
	if (code === 0) {
		const message = hasFix 
			? '\\n✓ Linting complete! All issues fixed automatically.\\n'
			: '\\n✓ Linting passed! No issues found.\\n';
		console.log(message);
		process.exit(0);
	} else {
		// ESLint already printed errors, just exit with the code
		process.exit(code);
	}
});
`;
}

function generateEslintConfig(customRules = {}) {
  // Default custom rules (common overrides)
  const defaultRules = {
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-empty-function": "off",
    "no-prototype-builtins": "off",
    "@typescript-eslint/no-misused-promises": ["error", {
      "checksVoidReturn": {
        "attributes": false,
        "properties": false,
        "returns": false,
        "variables": false
      }
    }]
  };
  
  // Merge custom rules with defaults (custom rules take precedence)
  const rules = { ...defaultRules, ...customRules };
  
  // Format rules as JavaScript object string
  const rulesString = Object.entries(rules)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `      "${key}": "${value}"`;
      } else if (Array.isArray(value)) {
        const valueStr = JSON.stringify(value);
        return `      "${key}": ${valueStr}`;
      } else {
        const valueStr = JSON.stringify(value);
        return `      "${key}": ${valueStr}`;
      }
    })
    .join(',\n');
  
  return `// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "dist/**", "*.js", "scripts/**"]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { 
        project: "./tsconfig.json",
        sourceType: "module"
      },
      globals: {
        ...globals.browser,
        DomElementInfo: "readonly",
        SvgElementInfo: "readonly",
        activeDocument: "readonly",
        activeWindow: "readonly",
        ajax: "readonly",
        ajaxPromise: "readonly",
        createDiv: "readonly",
        createEl: "readonly",
        createFragment: "readonly",
        createSpan: "readonly",
        createSvg: "readonly",
        fish: "readonly",
        fishAll: "readonly",
        isBoolean: "readonly",
        nextFrame: "readonly",
        ready: "readonly",
        sleep: "readonly"
      }
    },
    // Custom rule overrides${Object.keys(customRules).length > 0 ? ' (migrated from .eslintrc)' : ''}
    rules: {
${rulesString}
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly"
      }
    }
  },
]);
`;
}

const NPMRC_CONTENT = "legacy-peer-deps=true\n";

function parseVersion(versionString) {
  // Remove ^, ~, >=, etc. and extract major.minor.patch
  const clean = versionString.replace(/^[\^~>=<]/, '');
  const parts = clean.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

// Removed unused compareVersions function

function isVersionCompatible(currentVersion, minVersion) {
  const current = parseVersion(currentVersion);
  const min = parseVersion(minVersion);
  
  if (current.major > min.major) return true;
  if (current.major < min.major) return false;
  if (current.minor > min.minor) return true;
  if (current.minor < min.minor) return false;
  return current.patch >= min.patch;
}

function migrateEslintrc(eslintrcPath) {
  try {
    const eslintrcContent = readFileSync(eslintrcPath, 'utf8');
    const eslintrc = JSON.parse(eslintrcContent);
    
    // Extract custom rules from .eslintrc
    const customRules = eslintrc.rules || {};
    
    console.log('✓ Found .eslintrc file - migrating rules to flat config format');
    
    return customRules;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.log('⚠ Warning: .eslintrc file is not valid JSON, using default rules');
    } else {
      console.log('⚠ Warning: Could not read .eslintrc file, using default rules');
    }
    return {};
  }
}

function fixBuiltinModules(esbuildConfigPath, projectRoot) {
  if (!existsSync(esbuildConfigPath)) {
    return false;
  }
  
  try {
    let content = readFileSync(esbuildConfigPath, 'utf8');
    let updated = false;
    
    // Check if it uses builtin-modules package
    if (content.includes("import builtins from \"builtin-modules\"") || 
        content.includes("import builtins from 'builtin-modules'")) {
      // Replace the import
      content = content.replace(
        /import\s+builtins\s+from\s+["']builtin-modules["'];?/g,
        "import { builtinModules } from \"module\";"
      );
      updated = true;
      console.log('✓ Updated esbuild.config.mjs: replaced builtin-modules with module.builtinModules');
    }
    
    // Check if it uses ...builtins (the spread)
    if (content.includes("...builtins") && !content.includes("...builtinModules")) {
      content = content.replace(/\.\.\.builtins/g, "...builtinModules");
      updated = true;
      console.log('✓ Updated esbuild.config.mjs: replaced builtins with builtinModules');
    }
    
    // Add existsSync import if not present and update entryPoints to detect main.ts location
    const hasExistsSyncImport = content.includes("existsSync") && (content.includes("from \"fs\"") || content.includes("from 'fs'"));
    const needsExistsSync = !hasExistsSyncImport;
    
    // Check if entryPoints needs to be updated to use detection logic
    const hasHardcodedEntryPoint = /entryPoints:\s*\[["'](src\/)?main\.ts["']\]/.test(content);
    const hasEntryPointVar = /const\s+entryPoint\s*=/.test(content);
    const entryPointIndex = hasEntryPointVar ? content.indexOf('const entryPoint') : -1;
    const esbuildContextIndex = content.indexOf('esbuild.context');
    const hasCorrectEntryPoint = hasEntryPointVar && 
      entryPointIndex >= 0 && 
      esbuildContextIndex >= 0 && 
      entryPointIndex < esbuildContextIndex;
    const hasEntryPointDetection = hasCorrectEntryPoint || (hasEntryPointVar && content.includes("existsSync(\"src/main.ts\")") || content.includes("existsSync('src/main.ts')"));
    
    // Check if the more sophisticated entry point detection pattern exists (with hasSrcMain, hasRootMain, warnings, etc.)
    // This pattern includes detection of both src/main.ts and main.ts with proper warnings/errors
    const hasAdvancedEntryPointDetection = /const\s+hasSrcMain\s*=/.test(content) && 
                                           /const\s+hasRootMain\s*=/.test(content) &&
                                           /const\s+entryPoint\s*=\s*hasSrcMain/.test(content);
    
    // Check if there's a simple pattern that should be upgraded to advanced
    const hasSimplePattern = /const\s+entryPoint\s*=\s*existsSync\(["']src\/main\.ts["']\)\s*\?/.test(content) &&
                             !hasAdvancedEntryPointDetection;
    
    // Always remove ALL entryPoint declarations first (we'll add it back in the correct place)
    // This ensures we don't have duplicates or incorrectly placed ones
    // BUT: Skip removal if the advanced detection pattern exists (it's already correct)
    // ALSO skip removal if we have a simple pattern (we'll upgrade it instead)
    if (hasEntryPointVar && !hasAdvancedEntryPointDetection && !hasSimplePattern) {
      // Remove comment lines that mention entry point detection
      content = content.replace(/\s*\/\/\s*.*[Dd]etect\s+entry\s+point.*?\n/gi, '');
      content = content.replace(/\s*\/\/\s*.*entry\s+point.*?\n/gi, '');
      // Remove const entryPoint declarations - match the full line including any whitespace
      content = content.replace(/^\s*const\s+entryPoint\s*=.*?;\s*$/gm, '');
      // Also remove any that might be on the same line as other code (less common)
      content = content.replace(/\s*const\s+entryPoint\s*=\s*existsSync\([^)]+\)\s*\?[^;]+;\s*/g, '');
      content = content.replace(/\s*const\s+entryPoint\s*=\s*[^;]+;\s*/g, '');
      // Clean up any double newlines that might result
      content = content.replace(/\n\n\n+/g, '\n\n');
      updated = true;
      console.log('✓ Removed existing entryPoint declaration(s)');
    }
    
    // Skip updating if advanced detection pattern already exists
    if (hasAdvancedEntryPointDetection) {
      // Already has the full detection pattern with warnings/errors, nothing to do
      if (hasHardcodedEntryPoint) {
        // But still fix entryPoints line if it's hardcoded
        content = content.replace(
          /(\s+)entryPoints:\s*\[["'](src\/)?main\.ts["']\],?/,
          "$1entryPoints: [entryPoint],"
        );
        updated = true;
        console.log('✓ Updated esbuild.config.mjs: fixed entryPoints to use entryPoint variable');
      }
    } else if (hasSimplePattern) {
      // Upgrade simple pattern to advanced pattern with warnings
      // Find the simple pattern (with or without comment) and replace it with the advanced one
      // Match: optional comment, then const entryPoint = existsSync("src/main.ts") ? "src/main.ts" : "main.ts";
      const simplePatternRegex = /(\/\/\s*Detect\s+entry\s+point[^\n]*\n\s*)?const\s+entryPoint\s*=\s*existsSync\(["']src\/main\.ts["']\)\s*\?[^;]+;/;
      if (simplePatternRegex.test(content)) {
        // Find where to insert (before esbuild.context)
        const esbuildContextMatch = content.match(/(\s*)(const\s+\w+\s*=\s*(?:await\s+)?esbuild\.context\s*\()/);
        if (esbuildContextMatch) {
          const indent = esbuildContextMatch[1];
          const advancedPattern = `${indent}// Detect entry point: prefer src/main.ts, fallback to main.ts
${indent}const hasSrcMain = existsSync("src/main.ts");
${indent}const hasRootMain = existsSync("main.ts");
${indent}
${indent}if (hasSrcMain && hasRootMain) {
${indent}  console.warn("WARNING: Both src/main.ts and main.ts exist. Using src/main.ts as entry point.");
${indent}  console.warn("Consider removing one to avoid confusion.");
${indent}}
${indent}if (!hasSrcMain && !hasRootMain) {
${indent}  console.error("ERROR: Neither src/main.ts nor main.ts found!");
${indent}  process.exit(1);
${indent}}
${indent}
${indent}// Set entry point based on what exists
${indent}const entryPoint = hasSrcMain ? "src/main.ts" : "main.ts";
`;
          // Remove the simple pattern
          content = content.replace(simplePatternRegex, '');
          // Insert advanced pattern before esbuild.context
          content = content.replace(/(\s*)(const\s+\w+\s*=\s*(?:await\s+)?esbuild\.context\s*\()/, advancedPattern + '$1$2');
          updated = true;
          console.log('✓ Upgraded esbuild.config.mjs: enhanced entry point detection with warnings and error handling');
        }
      }
    } else if (hasHardcodedEntryPoint || (hasEntryPointVar && !hasCorrectEntryPoint)) {
      // Add existsSync import if needed
      if (needsExistsSync) {
        // Find the import statement and add existsSync to it, or add a new import
        if (content.includes("import { builtinModules } from \"module\"")) {
          content = content.replace(
            /import\s+{\s*builtinModules\s*}\s+from\s+["']module["']/,
            "import { builtinModules } from \"module\";\nimport { existsSync } from \"fs\";"
          );
        } else if (content.includes("import { builtinModules } from 'module'")) {
          content = content.replace(
            /import\s+{\s*builtinModules\s*}\s+from\s+['']module['']/,
            "import { builtinModules } from 'module';\nimport { existsSync } from 'fs';"
          );
        } else {
          // Add import after process import or at the top
          const processImportMatch = content.match(/import\s+process\s+from\s+["']process["'];?/);
          if (processImportMatch) {
            content = content.replace(
              /(import\s+process\s+from\s+["']process["'];?)/,
              "$1\nimport { existsSync } from \"fs\";"
            );
          } else {
            // Add at the beginning after first import
            const firstImportMatch = content.match(/^import\s+[^;]+;?/m);
            if (firstImportMatch) {
              content = content.replace(
                /^(import\s+[^;]+;?)/m,
                "$1\nimport { existsSync } from \"fs\";"
              );
            }
          }
        }
        updated = true;
        console.log('✓ Updated esbuild.config.mjs: added existsSync import');
      }
      
      // Replace hardcoded entryPoints with detection logic or fix incorrectly placed ones
      // Re-check after removal (content may have changed)
      const entryPointPattern = /entryPoints:\s*\[["'](src\/)?main\.ts["']\]/;
      const currentHasEntryPointVar = /const\s+entryPoint\s*=/.test(content);
      const currentEntryPointIndex = currentHasEntryPointVar ? content.indexOf('const entryPoint') : -1;
      const currentEsbuildContextIndex = content.indexOf('esbuild.context');
      const currentHasCorrectEntryPoint = currentHasEntryPointVar && 
        currentEntryPointIndex >= 0 && 
        currentEsbuildContextIndex >= 0 && 
        currentEntryPointIndex < currentEsbuildContextIndex;
      
      // If we have a hardcoded entry point OR the entryPoint var is missing/incorrectly placed, fix it
      if (entryPointPattern.test(content) || !currentHasCorrectEntryPoint) {
        // Add entryPoint declaration if it doesn't exist or is incorrectly placed
        if (!currentHasCorrectEntryPoint) {
          // Find the "const prod" line - it's almost always present and right before esbuild.context
          const prodMatch = content.match(/(const\s+prod\s*=.*?;)\s*\n/);
          if (prodMatch) {
            // Insert advanced entry point detection right after const prod line
            const entryPointCode = `\n// Detect entry point: prefer src/main.ts, fallback to main.ts\nconst hasSrcMain = existsSync("src/main.ts");\nconst hasRootMain = existsSync("main.ts");\n\nif (hasSrcMain && hasRootMain) {\n  console.warn("WARNING: Both src/main.ts and main.ts exist. Using src/main.ts as entry point.");\n  console.warn("Consider removing one to avoid confusion.");\n}\nif (!hasSrcMain && !hasRootMain) {\n  console.error("ERROR: Neither src/main.ts nor main.ts found!");\n  process.exit(1);\n}\n\n// Set entry point based on what exists\nconst entryPoint = hasSrcMain ? "src/main.ts" : "main.ts";\n`;
            content = content.replace(
              /(const\s+prod\s*=.*?;)\s*\n/,
              "$1" + entryPointCode
            );
          } else {
            // Fallback: find esbuild.context and insert before it (but outside object literal)
            // Look for the line that starts with "const context = await esbuild.context" or similar
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (/^\s*const\s+\w+\s*=\s*(?:await\s+)?esbuild\.context\s*\(/.test(lines[i])) {
                const indent = lines[i].match(/^(\s*)/)[1];
                const entryPointCode = `${indent}// Detect entry point: prefer src/main.ts, fallback to main.ts\n${indent}const hasSrcMain = existsSync("src/main.ts");\n${indent}const hasRootMain = existsSync("main.ts");\n${indent}\n${indent}if (hasSrcMain && hasRootMain) {\n${indent}  console.warn("WARNING: Both src/main.ts and main.ts exist. Using src/main.ts as entry point.");\n${indent}  console.warn("Consider removing one to avoid confusion.");\n${indent}}\n${indent}if (!hasSrcMain && !hasRootMain) {\n${indent}  console.error("ERROR: Neither src/main.ts nor main.ts found!");\n${indent}  process.exit(1);\n${indent}}\n${indent}\n${indent}// Set entry point based on what exists\n${indent}const entryPoint = hasSrcMain ? "src/main.ts" : "main.ts";\n`;
                lines.splice(i, 0, entryPointCode);
                content = lines.join('\n');
                break;
              }
            }
          }
        }
        
        // Then replace the entryPoints line to use the variable
        content = content.replace(
          /(\s+)entryPoints:\s*\[["'](src\/)?main\.ts["']\],?/,
          "$1entryPoints: [entryPoint],"
        );
        updated = true;
        console.log('✓ Updated esbuild.config.mjs: added entry point detection (supports both src/main.ts and main.ts)');
      } else if (hasEntryPointVar && /entryPoints:\s*\[entryPoint\]/.test(content)) {
        // Already has entry point detection, nothing to do
      } else if (hasEntryPointVar) {
        // Has entryPoint var but entryPoints line doesn't use it - fix that
        content = content.replace(
          /(\s+)entryPoints:\s*\[["'][^"']+["']\],?/,
          "$1entryPoints: [entryPoint],"
        );
        updated = true;
        console.log('✓ Updated esbuild.config.mjs: fixed entryPoints to use entryPoint variable');
      }
    }
    
    // Ensure outfile is set to "main.js" (always output to root)
    // Remove any production/development logic that outputs to dist/
    const hasProdLogic = /const\s+prod\s*=.*process\.argv/.test(content);
    const hasDistOutput = /outfile.*dist\/main\.js/.test(content);
    
    // Remove production logic if it exists (simplify to always output to root)
    if (hasProdLogic) {
      // Remove const prod line
      content = content.replace(/const\s+prod\s*=.*process\.argv[^;]+;\s*\n?/g, '');
      // Remove dist/ directory creation logic
      content = content.replace(/if\s*\(prod\s*&&\s*!existsSync\(["']dist["']\)\)\s*\{[^}]+\}\s*\n?/g, '');
      // Remove production-specific messages
      content = content.replace(/if\s*\(prod\)\s*\{[^}]+\}\s*else\s*\{[^}]+\}\s*\n?/g, '');
      updated = true;
      console.log('✓ Updated esbuild.config.mjs: removed production/development split (always outputs to root)');
    }
    
    // Ensure outfile is set to "main.js" (not dist/main.js)
    if (hasDistOutput || /outfile:\s*outfile/.test(content)) {
      // Replace any outfile variable or dist/main.js with simple "main.js"
      content = content.replace(
        /(\s+)outfile:\s*(outfile|["']dist\/main\.js["']|["']main\.js["']),?/,
        '$1outfile: "main.js",'
      );
      // Remove outfile variable declaration if it exists
      content = content.replace(/const\s+outfile\s*=.*?;\s*\n?/g, '');
      updated = true;
      console.log('✓ Updated esbuild.config.mjs: fixed outfile to always output to root');
    } else if (!/outfile:/.test(content)) {
      // Add outfile if it doesn't exist
      const contextConfigMatch = content.match(/(esbuild\.context\s*\(\s*\{[^}]*?)(\n\s*\})/s);
      if (contextConfigMatch) {
        const indent = contextConfigMatch[1].match(/(\n\s+)$/)?.[1] || '\n\t';
        content = content.replace(
          /(esbuild\.context\s*\(\s*\{[^}]*?)(\n\s*\})/s,
          `$1${indent}outfile: "main.js",$2`
        );
        updated = true;
        console.log('✓ Updated esbuild.config.mjs: added outfile to esbuild.context');
      }
    }
    
    // Fix build mode detection to handle both "build" and "production" arguments
    // SIMPLE AND DIRECT: Check if production is missing, then fix it
    const hasProductionInCheck = /isOneTimeBuild.*production/.test(content) || 
                                  /args\.includes\(["']production["']\)/.test(content);
    const hasIsOneTimeBuild = /const\s+isOneTimeBuild\s*=/.test(content);
    const hasArgsSlice = /const\s+args\s*=\s*process\.argv\.slice\(2\)/.test(content);
    
    // If we have isOneTimeBuild but no production check, FIX IT
    if (hasIsOneTimeBuild && !hasProductionInCheck) {
      // Ensure args.slice exists first
      if (!hasArgsSlice) {
        content = content.replace(
          /(const\s+isOneTimeBuild\s*=)/,
          'const args = process.argv.slice(2);\n$1'
        );
        updated = true;
      }
      
      // Now fix the actual check - use a simple line-by-line approach
      const lines = content.split('\n');
      let fixed = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // If this line has isOneTimeBuild with args.includes("build") but no production
        if (/const\s+isOneTimeBuild\s*=/.test(line) && /args\.includes\(["']build["']\)/.test(line) && !/production/.test(line)) {
          lines[i] = line.replace(
            /(args\.includes\(["']build["']\))/,
            'args.includes("build") || args.includes("production")'
          );
          fixed = true;
          updated = true;
          break;
        }
        // If this line has isOneTimeBuild with process.argv[2] === "build"
        else if (/const\s+isOneTimeBuild\s*=/.test(line) && /process\.argv\[2\]/.test(line) && !/production/.test(line)) {
          lines[i] = line.replace(
            /(process\.argv\[2\]\s*===?\s*["']build["'])/,
            'args.includes("build") || args.includes("production")'
          );
          fixed = true;
          updated = true;
          break;
        }
        // If this is the isOneTimeBuild line but the check is on the next line
        else if (/const\s+isOneTimeBuild\s*=/.test(line) && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (/args\.includes\(["']build["']\)/.test(nextLine) && !/production/.test(nextLine)) {
            lines[i + 1] = nextLine.replace(
              /(args\.includes\(["']build["']\))/,
              'args.includes("build") || args.includes("production")'
            );
            fixed = true;
            updated = true;
            break;
          }
        }
      }
      
      if (fixed) {
        content = lines.join('\n');
        console.log('✓ Updated esbuild.config.mjs: build mode detection now supports both "build" and "production" arguments');
      }
    } else if (!hasIsOneTimeBuild && !hasArgsSlice) {
      // Add build mode detection if it doesn't exist
      const watchModeMatch = content.match(/(await\s+context\.watch\(\))/);
      if (watchModeMatch) {
        const beforeWatch = content.substring(0, watchModeMatch.index);
        const afterWatch = content.substring(watchModeMatch.index);
        const buildModeCheck = `\n// Check if this is a one-time build or watch mode\n// Check for "build" or "production" argument - supports both patterns\nconst args = process.argv.slice(2);\nconst isOneTimeBuild = args.includes("build") || args.includes("production");\n\nif (isOneTimeBuild) {\n\t// Production build: build once and exit\n\tawait context.rebuild();\n\tconsole.log("\\n✓ Build complete!");\n\tconsole.log("📦 Release files:");\n\tconsole.log("   - main.js");\n\tif (existsSync("manifest.json")) {\n\t\tconsole.log("   - manifest.json");\n\t}\n\tif (existsSync("styles.css")) {\n\t\tconsole.log("   - styles.css");\n\t}\n\tconsole.log("\\n💡 Upload these files to GitHub releases\\n");\n\tawait context.dispose();\n\tprocess.exit(0);\n} else {\n\t// Development mode: watch for changes\n\tconsole.log("\\n✓ Development build running in watch mode");\n\tconsole.log("📝 Building to main.js in root");\n\tconsole.log("💡 For production builds, run: npm run build\\n");\n\t`;
        content = beforeWatch + buildModeCheck + afterWatch;
        updated = true;
        console.log('✓ Updated esbuild.config.mjs: added build mode detection (supports both "build" and "production")');
      }
    }
    
    if (updated) {
      writeFileSync(esbuildConfigPath, content, 'utf8');
      return true;
    }
    
    return false;
  } catch (error) {
    console.log('⚠ Warning: Could not update esbuild.config.mjs:', error.message);
    return false;
  }
}

function setupESLint() {
  // Check Node.js version (requires v16+)
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (majorVersion < 16) {
    console.error(`❌ Error: Node.js v16+ is required (found ${nodeVersion})`);
    console.error('Please upgrade Node.js from https://nodejs.org/');
    process.exit(1);
  }
  
  // Get the directory where this script is located
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  // Resolve project root (one level up from scripts folder)
  const projectRoot = join(scriptDir, '..');
  const packageJsonPath = join(projectRoot, 'package.json');
  const eslintConfigPath = join(projectRoot, 'eslint.config.mjs');
  const esbuildConfigPath = join(projectRoot, 'esbuild.config.mjs');
  const eslintrcPath = join(projectRoot, '.eslintrc');
  const eslintrcJsonPath = join(projectRoot, '.eslintrc.json');
  const npmrcPath = join(projectRoot, '.npmrc');
  
  try {
    // Read package.json
    const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    
    let updated = false;
    let migratingFromEslint8 = false;
    let customRules = {};
    
    // Check if migrating from ESLint 8
    const currentEslintVersion = packageJson.devDependencies?.eslint || packageJson.dependencies?.eslint;
    if (currentEslintVersion && currentEslintVersion.match(/^[\^~]?8\./)) {
      migratingFromEslint8 = true;
      console.log('🔄 Detected ESLint 8 - migrating to ESLint 9...\n');
    }
    
    // Check for legacy .eslintrc files and migrate rules
    if (existsSync(eslintrcPath)) {
      customRules = migrateEslintrc(eslintrcPath);
    } else if (existsSync(eslintrcJsonPath)) {
      customRules = migrateEslintrc(eslintrcJsonPath);
    }
    
    // Check and update TypeScript version
    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
      updated = true;
    }
    
    const currentTsVersion = packageJson.devDependencies.typescript || packageJson.dependencies?.typescript;
    if (currentTsVersion && !isVersionCompatible(currentTsVersion, MIN_TYPESCRIPT_VERSION)) {
      console.log(`⚠ TypeScript version ${currentTsVersion} is not compatible with ESLint (requires >=4.8.4)`);
      console.log(`✓ Updating TypeScript to ${MIN_TYPESCRIPT_VERSION}`);
      packageJson.devDependencies.typescript = MIN_TYPESCRIPT_VERSION;
      updated = true;
    } else if (!currentTsVersion) {
      console.log(`✓ Adding TypeScript ${MIN_TYPESCRIPT_VERSION}`);
      packageJson.devDependencies.typescript = MIN_TYPESCRIPT_VERSION;
      updated = true;
    }
    
    // Remove deprecated builtin-modules package if it exists
    if (packageJson.devDependencies?.["builtin-modules"]) {
      delete packageJson.devDependencies["builtin-modules"];
      updated = true;
      console.log('✓ Removed deprecated builtin-modules package (use module.builtinModules instead)');
    }
    if (packageJson.dependencies?.["builtin-modules"]) {
      delete packageJson.dependencies["builtin-modules"];
      updated = true;
      console.log('✓ Removed deprecated builtin-modules package (use module.builtinModules instead)');
    }
    
    // Add or update ESLint devDependencies
    for (const [dep, version] of Object.entries(ESLINT_DEPS)) {
      if (!packageJson.devDependencies[dep] || packageJson.devDependencies[dep] !== version) {
        packageJson.devDependencies[dep] = version;
        updated = true;
        console.log(`✓ Added/updated devDependency: ${dep}@${version}`);
      }
    }
    
    // Add or update scripts
    if (!packageJson.scripts) {
      packageJson.scripts = {};
      updated = true;
    }
    
    for (const [script, command] of Object.entries(ESLINT_SCRIPTS)) {
      const currentCommand = packageJson.scripts[script];
      // Remove --ext flag if present (ESLint 8 legacy)
      if (currentCommand && currentCommand.includes('--ext')) {
        console.log(`✓ Updating ${script} script: removing --ext flag (not needed in ESLint 9)`);
        updated = true;
      }
      if (!currentCommand || currentCommand !== command) {
        packageJson.scripts[script] = command;
        updated = true;
        if (currentCommand) {
          console.log(`✓ Updated script: ${script}`);
        } else {
          console.log(`✓ Added script: ${script}`);
        }
      }
    }
    
    // Generate eslint.config.mjs file (flat config for ESLint 9)
    let eslintConfigUpdated = false;
    const newConfig = generateEslintConfig(customRules);
    
    if (!existsSync(eslintConfigPath)) {
      writeFileSync(eslintConfigPath, newConfig, 'utf8');
      console.log('✓ Created eslint.config.mjs configuration file');
      eslintConfigUpdated = true;
    } else {
      // Update existing file to ensure it has the correct config
      const existingContent = readFileSync(eslintConfigPath, 'utf8');
      if (existingContent.trim() !== newConfig.trim()) {
        writeFileSync(eslintConfigPath, newConfig, 'utf8');
        console.log('✓ Updated eslint.config.mjs configuration file');
        eslintConfigUpdated = true;
      }
    }
    
    // Remove legacy .eslintrc files after migration
    if (existsSync(eslintrcPath)) {
      try {
        unlinkSync(eslintrcPath);
        console.log('✓ Removed legacy .eslintrc file (migrated to eslint.config.mjs)');
      } catch {
        console.log('⚠ Warning: Could not remove .eslintrc file');
      }
    }
    if (existsSync(eslintrcJsonPath)) {
      try {
        unlinkSync(eslintrcJsonPath);
        console.log('✓ Removed legacy .eslintrc.json file (migrated to eslint.config.mjs)');
      } catch {
        console.log('⚠ Warning: Could not remove .eslintrc.json file');
      }
    }
    
    // Fix builtin-modules in esbuild.config.mjs and entryPoints
    const esbuildConfigUpdated = fixBuiltinModules(esbuildConfigPath, projectRoot);
    
    // Generate and copy lint-wrapper.mjs if it doesn't exist or needs updating
    const lintWrapperPath = join(projectRoot, 'scripts', 'lint-wrapper.mjs');
    const lintWrapperSource = generateLintWrapper();
    let lintWrapperUpdated = false;
    
    // Ensure scripts directory exists
    const scriptsDir = join(projectRoot, 'scripts');
    if (!existsSync(scriptsDir)) {
      mkdirSync(scriptsDir, { recursive: true });
    }
    
    if (!existsSync(lintWrapperPath)) {
      writeFileSync(lintWrapperPath, lintWrapperSource, 'utf8');
      console.log('✓ Created scripts/lint-wrapper.mjs');
      lintWrapperUpdated = true;
    } else {
      // Update if content differs (in case of updates)
      const existingContent = readFileSync(lintWrapperPath, 'utf8');
      if (existingContent !== lintWrapperSource) {
        writeFileSync(lintWrapperPath, lintWrapperSource, 'utf8');
        console.log('✓ Updated scripts/lint-wrapper.mjs');
        lintWrapperUpdated = true;
      }
    }
    
    // Generate .npmrc file
    let npmrcUpdated = false;
    if (!existsSync(npmrcPath)) {
      writeFileSync(npmrcPath, NPMRC_CONTENT, 'utf8');
      console.log('✓ Created .npmrc configuration file');
      npmrcUpdated = true;
    } else {
      const existingContent = readFileSync(npmrcPath, 'utf8');
      if (existingContent !== NPMRC_CONTENT) {
        writeFileSync(npmrcPath, NPMRC_CONTENT, 'utf8');
        console.log('✓ Updated .npmrc configuration file');
        npmrcUpdated = true;
      }
    }
    
    if (updated) {
      // Write back to package.json with proper formatting
      const updatedContent = JSON.stringify(packageJson, null, '\t') + '\n';
      writeFileSync(packageJsonPath, updatedContent, 'utf8');
      console.log('\n✓ package.json updated successfully!');
    }
    
    if (updated || eslintConfigUpdated || esbuildConfigUpdated || npmrcUpdated || lintWrapperUpdated) {
      console.log('\n✓ ESLint setup complete!');
      if (migratingFromEslint8) {
        console.log('✓ Successfully migrated from ESLint 8 to ESLint 9');
      }
      console.log('\nNext steps:');
      console.log('  1. Run: npm install');
      console.log('  2. Run: npm run lint');
    } else {
      console.log('✓ Everything is already set up correctly!');
      console.log('  Run: npm run lint');
    }
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ Error: package.json not found in project root');
      process.exit(1);
    } else if (error instanceof SyntaxError) {
      console.error('❌ Error: package.json is not valid JSON');
      console.error(error.message);
      process.exit(1);
    } else {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  }
}

setupESLint();

