import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    moduleNameMapper: {
        '^main$': '<rootDir>/src/main.ts',
        '^electron$': '<rootDir>/__mocks__/electron.ts',
        '^obsidian$': '<rootDir>/__mocks__/obsidian.ts',
        // Add any other module mappings here
    },
    setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    verbose: true,
};

export default config;
