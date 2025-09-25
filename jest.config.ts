import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    moduleNameMapper: {
        '^main$': '<rootDir>/src/main.ts',
        '^electron$': '<rootDir>/__mocks__/electron.ts',
        '^obsidian$': '<rootDir>/__mocks__/obsidian.ts',
        '^@app/(.*)$': '<rootDir>/src/app/$1',
        '^@ui/(.*)$': '<rootDir>/src/ui/$1',
        '^@features/(.*)$': '<rootDir>/src/features/$1',
        '^@integrations/(.*)$': '<rootDir>/src/integrations/$1',
        '^@services/(.*)$': '<rootDir>/src/services/$1',
        '^@types$': '<rootDir>/src/types/index.ts',
        '^@types/(.*)$': '<rootDir>/src/types/$1',
        '^@schemas/(.*)$': '<rootDir>/src/schemas/$1',
        '^@test-utils/(.*)$': '<rootDir>/src/test-utils/$1',
        // Add any other module mappings here
    },
    setupFiles: ['<rootDir>/src/tests/setup-env.ts'],
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
