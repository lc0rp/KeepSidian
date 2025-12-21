#!/usr/bin/env node

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
			? '\n✓ Linting complete! All issues fixed automatically.\n'
			: '\n✓ Linting passed! No issues found.\n';
		console.log(message);
		process.exit(0);
	} else {
		// ESLint already printed errors, just exit with the code
		process.exit(code);
	}
});
