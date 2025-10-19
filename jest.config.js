/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom', // Use jsdom for React testing by default
  roots: ['<rootDir>/src', '<rootDir>/electron'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'create-fixtures.ts',
    'generate-fixtures.cjs',
  ],
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },

  // ESM Configuration: Transform ESM-only packages in node_modules
  // Negative lookahead: "ignore all node_modules EXCEPT p-limit and yocto-queue"
  transformIgnorePatterns: [
    'node_modules/(?!(p-limit|yocto-queue)/)',
  ],

  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: 'node',
        jsx: 'react',
      },
      useESM: false,  // Transform ESM to CommonJS for Jest compatibility
    }],
    // Transform JavaScript files from ESM packages
    '^.+\\.js$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/styleMock.js',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
};